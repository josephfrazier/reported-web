import Parse from 'parse/node';
import cookie from 'cookie';

import {
  parseHomeState,
  serializeHomeState,
  withoutPassword,
} from './homeStateCookie.js';
import { logIn } from './users.js';

// The browser's session cookie. It holds the Parse session token, so it is
// HttpOnly: no script (and no XSS) can read it, and the server is the only
// party that ever sees the token.
export const SESSION_COOKIE = 'reportedWebSession';

// Parse sessions last a year by default (parse-server's sessionLength), and
// every authenticated request re-sets this cookie, so an active user's cookie
// never expires before the session it stands for.
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Secure only where the request arrived over https: `req.secure` follows
// X-Forwarded-Proto through the trusted proxy in production (src/config.js)
// and stays false on local http, where a Secure cookie would never be stored.
const cookieOptions = req => ({
  httpOnly: true,
  secure: req.secure,
  sameSite: 'lax',
  path: '/',
});

export const readSessionToken = req =>
  cookie.parse(req.headers.cookie || '')[SESSION_COOKIE] || null;

export const setSessionCookie = (res, req, sessionToken) => {
  res.cookie(SESSION_COOKIE, sessionToken, {
    ...cookieOptions(req),
    maxAge: SESSION_MAX_AGE_MS,
  });
};

export const clearSessionCookie = (res, req) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
};

// 401 in the shape handlePromiseRejection understands: it reads `status`
// (src/handlePromiseRejection.js) and rebuilds `message` for the body.
const unauthorizedError = () => {
  const error = new Error('Please log in to continue.');
  // Error's `message` is non-enumerable, so handlePromiseRejection's
  // json-stringify-safe round-trip would drop it before it reaches the client.
  Object.defineProperty(error, 'message', {
    enumerable: true,
    value: error.message,
  });
  error.status = 401;
  return error;
};

// The request's user, resolved from the session cookie, or -- during the
// transition away from credentials stored by the client -- from the
// email/password an old client still sends. Resolves to
// `{ user, sessionToken, viaCredentials }` and rejects with a 401 error when
// neither source authenticates.
export const authenticate = async req => {
  const sessionToken = readSessionToken(req);
  if (sessionToken) {
    try {
      const user = await Parse.User.me(sessionToken);
      return { user, sessionToken, viaCredentials: false };
    } catch (error) {
      // An expired or revoked session falls through to the transitional
      // credentials. Anything else (a network failure, a 5xx) is a real error
      // and must not be reported to the client as "please log in".
      if (error?.code !== Parse.Error.INVALID_SESSION_TOKEN) {
        throw error;
      }
    }
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    throw unauthorizedError();
  }

  let user;
  try {
    user = await logIn({ email, password });
  } catch (error) {
    // Parse's code for a failed log-in is the same "object not found" it uses
    // elsewhere; from here it means the credentials did not authenticate.
    if (error?.code === Parse.Error.OBJECT_NOT_FOUND) {
      throw unauthorizedError();
    }
    // logIn's own messages (such as the "we just sent you an email" one for
    // an unverified address) still reach the client.
    throw error;
  }
  console.info('[session] legacy credential auth used');
  return { user, sessionToken: user.getSessionToken(), viaCredentials: true };
};

// The route adapter: the extracted modules take a `() => Promise<{ user,
// sessionToken }>`, and building it here keeps the request object in the
// route. Every success re-sets the cookie, which both slides its expiry and
// hands a session cookie to a legacy client that just authenticated with
// credentials.
export const authenticateRequest = (req, res) => () =>
  authenticate(req).then(result => {
    setSessionCookie(res, req, result.sessionToken);
    return result;
  });

// SSR only: decide whether this page load is logged in, and migrate a legacy
// visitor to a session cookie. Their state cookie still holds the password
// their browser used to re-send on every request; the server logs in with it
// once and rewrites the cookie without it, so the visitor notices nothing.
//
// Never rejects: a page must render even if Parse is unreachable. A session
// cookie whose token cannot be checked here is taken at face value -- the API
// routes verify it, and the client reacts to their 401s.
export const resolveSsrSession = async ({ req, res }) => {
  let homeState = parseHomeState(req.headers.cookie);
  const sessionToken = readSessionToken(req);

  if (sessionToken) {
    // Re-set on every page load, so the browser cookie never expires before
    // the Parse session it stands for.
    setSessionCookie(res, req, sessionToken);
    if (homeState?.password) {
      homeState = withoutPassword(homeState);
      res.append(
        'Set-Cookie',
        serializeHomeState(homeState, { secure: req.secure }),
      );
    }
    return { sessionPresent: true, homeState };
  }

  const hasLegacyCredentials =
    homeState?.loginSuccessful && homeState.email && homeState.password;
  if (!hasLegacyCredentials) {
    return { sessionPresent: false, homeState };
  }

  let sessionPresent = false;
  try {
    const user = await logIn({
      email: homeState.email,
      password: homeState.password,
    });
    setSessionCookie(res, req, user.getSessionToken());
    sessionPresent = true;
  } catch (error) {
    // The stored password no longer authenticates (changed, wrong, or the
    // account needs verification). Strip it and show the logged-out page.
    console.error(
      '[session] legacy state-cookie login failed:',
      error?.message,
    );
  }

  homeState = {
    ...withoutPassword(homeState),
    loginSuccessful: sessionPresent,
  };
  res.append(
    'Set-Cookie',
    serializeHomeState(homeState, { secure: req.secure }),
  );
  return { sessionPresent, homeState };
};

// SameSite=Lax keeps the session cookie off cross-site POSTs in current
// browsers. This closes the gap for browsers that predate SameSite, and for
// login CSRF (a cross-site form post would otherwise log the victim into
// someone else's account). Only requests that name a different host are
// refused.
export const rejectCrossSiteRequest = (req, res, next) => {
  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS'
  ) {
    next();
    return;
  }

  const source = req.get('origin') || req.get('referer');
  if (!source) {
    // Not a browser request, or one that sends neither header.
    next();
    return;
  }

  let sourceHost = null;
  try {
    sourceHost = new URL(source).host;
  } catch {
    // An unparseable header proves nothing either way.
  }

  if (sourceHost && sourceHost !== req.get('host')) {
    res.status(403).json({ error: { message: 'Cross-site request refused.' } });
    return;
  }

  next();
};
