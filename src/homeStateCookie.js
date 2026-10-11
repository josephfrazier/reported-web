import cookie from 'cookie';

// The form-state cookie the browser keeps between visits (plate, address,
// preferences). It is deliberately not HttpOnly: the client writes it as the
// user types. The session credential lives in its own HttpOnly cookie (see
// src/session.js), and the server uses this module to parse the state cookie
// and to rewrite it without the password legacy clients still have in theirs.
export const HOME_STATE_COOKIE = 'reportedWebHomeState';

// `cookie.serialize` takes maxAge in seconds (Express's res.cookie takes
// milliseconds, which is why the session cookie's max age is separate).
export const HOME_STATE_MAX_AGE = 365 * 24 * 60 * 60;

export const parseHomeState = cookieHeader => {
  const value = cookie.parse(cookieHeader || '')[HOME_STATE_COOKIE];
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    // A corrupted cookie is the same as no cookie.
    return null;
  }
};

export const serializeHomeState = (
  state,
  { maxAge = HOME_STATE_MAX_AGE, secure = false } = {},
) =>
  cookie.serialize(HOME_STATE_COOKIE, JSON.stringify(state), {
    maxAge,
    path: '/',
    sameSite: 'lax',
    secure,
  });

// A copy of the state without the password, for rewriting a legacy cookie
// once its owner has a session cookie instead.
export const withoutPassword = state => {
  const { password, ...rest } = state;
  return rest;
};
