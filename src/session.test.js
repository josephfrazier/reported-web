/**
 * @jest-environment node
 *
 * The cookie helpers and the Origin guard are pure, but `authenticate`
 * resolves tokens against a real Parse Server 2.8.4 (the version prod runs),
 * backed by MongoDB 4.4 from mongodb-memory-server, so the session semantics
 * under test are the real ones.
 */

import net from 'net';

import Parse from 'parse/node';
import { HOME_STATE_COOKIE, serializeHomeState } from './homeStateCookie.js';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  authenticate,
  authenticateRequest,
  clearSessionCookie,
  readSessionToken,
  rejectCrossSiteRequest,
  resolveSsrSession,
  setSessionCookie,
} from './session.js';

const { MongoMemoryServer } = require('mongodb-memory-server');
// parse-server is deliberately installed on demand instead of being a project
// dependency (see jest.globalSetup.js)
const { ParseServer } = require('parse-server');

// parse-server skips its cloud/URL verification (and test-unfriendly process
// listeners) when TESTING is set. Must be set before it is constructed.
process.env.TESTING = '1';

jest.setTimeout(30000);

const email = 'test@example.com';
const password = 'test-password';

const cookieRequest = sessionToken => ({
  headers: {
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
  },
  body: {},
});

const fakeResponse = () => {
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    append: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
};

// The `name=value` part of a state cookie, to build request headers with.
const stateCookieHeader = state => serializeHomeState(state).split(';')[0];

const setCookies = res =>
  res.append.mock.calls
    .filter(([name]) => name === 'Set-Cookie')
    .map(([, value]) => value);

describe('session cookie helpers', () => {
  const req = { secure: true };

  test('setSessionCookie marks the cookie HttpOnly, Lax, and Secure in https', () => {
    const res = fakeResponse();
    setSessionCookie(res, req, 'r:token');

    expect(res.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'r:token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });
  });

  test('setSessionCookie leaves Secure off on local http', () => {
    const res = fakeResponse();
    setSessionCookie(res, { secure: false }, 'r:token');

    expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: false });
  });

  test('clearSessionCookie clears with the same attributes', () => {
    const res = fakeResponse();
    clearSessionCookie(res, req);

    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  test('readSessionToken reads the cookie and tolerates its absence', () => {
    expect(readSessionToken(cookieRequest('r:abc'))).toBe('r:abc');
    expect(readSessionToken({ headers: {} })).toBeNull();
    expect(
      readSessionToken({ headers: { cookie: 'other=1; x=2' } }),
    ).toBeNull();
  });
});

describe('rejectCrossSiteRequest', () => {
  const call = ({ method, origin, referer, host = 'example.com' }) => {
    const headers = { origin, referer, host };
    const req = {
      method,
      get: name => headers[name],
    };
    const res = fakeResponse();
    const next = jest.fn();
    rejectCrossSiteRequest(req, res, next);
    return { res, next };
  };

  test('lets same-host and headerless requests through', () => {
    expect(
      call({ method: 'POST', origin: 'https://example.com' }).next,
    ).toHaveBeenCalled();
    expect(call({ method: 'POST' }).next).toHaveBeenCalled();
    expect(
      call({ method: 'GET', origin: 'https://evil.example' }).next,
    ).toHaveBeenCalled();
  });

  test('falls back to the Referer when there is no Origin', () => {
    expect(
      call({ method: 'POST', referer: 'https://example.com/submit' }).next,
    ).toHaveBeenCalled();
  });

  test('refuses a POST that names another host', () => {
    const { res, next } = call({
      method: 'POST',
      origin: 'https://evil.example',
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: { message: 'Cross-site request refused.' },
    });
  });
});

describe('authenticate', () => {
  let mongo;
  let parseServer;
  let verifiedUser;

  beforeAll(async () => {
    // MongoDB 4.4 is the newest version whose wire protocol parse-server
    // 2.8.4's bundled mongodb driver can talk to. Note: the binary must be
    // downloaded once (mongodb-memory-server caches it), and on Ubuntu 24+
    // mongod 4.4 needs libssl1.1 installed.
    mongo = await MongoMemoryServer.create({ binary: { version: '4.4.14' } });

    // create() can resolve a moment before mongod accepts connections;
    // parse-server connects to it in its constructor, so wait until the
    // port actually accepts a TCP connection.
    const { port } = new URL(mongo.getUri());
    const attemptConnection = (resolve, reject, attempts) => {
      const socket = net.connect(Number(port), '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (attempts < 100) {
          setTimeout(
            () => attemptConnection(resolve, reject, attempts + 1),
            50,
          );
        } else {
          reject(new Error('mongod never accepted connections'));
        }
      });
    };
    await new Promise((resolve, reject) => {
      attemptConnection(resolve, reject, 0);
    });

    parseServer = ParseServer.start(
      {
        databaseURI: mongo.getUri(),
        appId: 'test-app',
        masterKey: 'test-master',
        // Only used as a placeholder; the client points at the real port.
        serverURL: 'http://localhost/parse',
        mountPath: '/parse',
        port: 0,
        verbose: false,
      },
      () => {},
    );
    await new Promise((resolve, reject) => {
      parseServer.server.once('listening', resolve);
      parseServer.server.once('error', reject);
    });
    // parse-server initializes its own nested parse SDK; ours needs it too.
    // The master key is switched on globally, as prod's server.js does today,
    // so the tests prove a bogus token still fails with it enabled.
    Parse.initialize('test-app', undefined, 'test-master');
    Parse.Cloud.useMasterKey();
    Parse.serverURL = `http://localhost:${parseServer.server.address().port}/parse`;

    // Parse Server 2.8.4 leaves emailVerified unset on signUp, and logIn()
    // throws its "check your email" error for such users, so create a
    // verified user the way prod users end up verified.
    verifiedUser = new Parse.User();
    verifiedUser.setUsername(email);
    verifiedUser.set('email', email);
    verifiedUser.setPassword(password);
    await verifiedUser.signUp();
    verifiedUser.set('emailVerified', true);
    await verifiedUser.save(null, {
      sessionToken: verifiedUser.getSessionToken(),
    });
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  test('resolves a valid session token', async () => {
    const result = await authenticate(
      cookieRequest(verifiedUser.getSessionToken()),
    );

    expect(result.user.id).toBe(verifiedUser.id);
    expect(result.sessionToken).toBe(verifiedUser.getSessionToken());
    expect(result.viaCredentials).toBe(false);
  });

  test('rejects a bogus token, even with the master key switched on', async () => {
    await expect(
      authenticate(cookieRequest('r:not-a-real-token')),
    ).rejects.toMatchObject({
      status: 401,
      message: 'Please log in to continue.',
    });
  });

  test('rejects a request with neither a token nor credentials', async () => {
    await expect(authenticate({ headers: {}, body: {} })).rejects.toMatchObject(
      { status: 401 },
    );
  });

  test('falls back to body credentials and returns a usable token', async () => {
    const result = await authenticate({
      headers: {},
      body: { email, password },
    });

    expect(result.user.id).toBe(verifiedUser.id);
    expect(result.viaCredentials).toBe(true);

    // The token it hands back is a real session.
    const resolved = await Parse.User.me(result.sessionToken);
    expect(resolved.id).toBe(verifiedUser.id);
  });

  test('two logins keep both sessions usable (one per browser)', async () => {
    // parse-server deletes a user's other sessions for the same installation
    // id when a session is created, so logIn() must give each login its own
    // id; otherwise this second login would revoke the first browser's
    // session, and could 401 it mid-request.
    const first = await authenticate({
      headers: {},
      body: { email, password },
    });
    const second = await authenticate({
      headers: {},
      body: { email, password },
    });

    await expect(Parse.User.me(first.sessionToken)).resolves.toMatchObject({
      id: verifiedUser.id,
    });
    await expect(Parse.User.me(second.sessionToken)).resolves.toMatchObject({
      id: verifiedUser.id,
    });
  });

  test('rejects wrong credentials as a 401, not a 500', async () => {
    await expect(
      authenticate({ headers: {}, body: { email, password: 'wrong' } }),
    ).rejects.toMatchObject({ status: 401 });
  });

  test('passes an unverified account message through unchanged', async () => {
    const unverified = new Parse.User();
    unverified.setUsername('unverified@example.com');
    unverified.set('email', 'unverified@example.com');
    unverified.setPassword('test-password');
    await unverified.signUp();

    await expect(
      authenticate({
        headers: {},
        body: { email: 'unverified@example.com', password: 'test-password' },
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('We just sent you an email'),
    });
  });

  test('logout revokes the session, so the same token then 401s', async () => {
    const result = await authenticate({
      headers: {},
      body: { email, password },
    });

    await Parse.User.logOut({ sessionToken: result.sessionToken });

    await expect(Parse.User.me(result.sessionToken)).rejects.toMatchObject({
      code: Parse.Error.INVALID_SESSION_TOKEN,
    });
    await expect(
      authenticate(cookieRequest(result.sessionToken)),
    ).rejects.toMatchObject({ status: 401 });
  });

  test('authenticateRequest re-sets the cookie on success (sliding)', async () => {
    const req = cookieRequest(verifiedUser.getSessionToken());
    const res = fakeResponse();

    const result = await authenticateRequest(req, res)();

    expect(result.user.id).toBe(verifiedUser.id);
    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      verifiedUser.getSessionToken(),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  test('authenticateRequest sets no cookie when authentication fails', async () => {
    const res = fakeResponse();

    await expect(
      authenticateRequest({ headers: {}, body: {} }, res)(),
    ).rejects.toMatchObject({ status: 401 });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  describe('resolveSsrSession', () => {
    test('reports a session and slides its cookie', async () => {
      const req = cookieRequest(verifiedUser.getSessionToken());
      const res = fakeResponse();

      const result = await resolveSsrSession({ req, res });

      expect(result.sessionPresent).toBe(true);
      expect(res.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE,
        verifiedUser.getSessionToken(),
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.append).not.toHaveBeenCalled();
    });

    test('migrates legacy credentials from the state cookie', async () => {
      const state = {
        email,
        password,
        loginSuccessful: true,
        plate: 'ABC1234',
      };
      const req = { headers: { cookie: stateCookieHeader(state) } };
      const res = fakeResponse();

      const result = await resolveSsrSession({ req, res });

      expect(result.sessionPresent).toBe(true);
      // The session cookie was set...
      const [, token] = res.cookie.mock.calls[0];
      await expect(Parse.User.me(token)).resolves.toMatchObject({
        id: verifiedUser.id,
      });
      // ...and the rewritten state cookie has no password in it.
      const [rewritten] = setCookies(res);
      expect(rewritten).toContain(HOME_STATE_COOKIE);
      expect(decodeURIComponent(rewritten)).not.toContain('password');
      expect(decodeURIComponent(rewritten)).toContain('ABC1234');
      expect(result.homeState.password).toBeUndefined();
      expect(result.homeState.loginSuccessful).toBe(true);
    });

    test('strips a password that no longer authenticates', async () => {
      const state = {
        email,
        password: 'wrong-password',
        loginSuccessful: true,
      };
      const req = { headers: { cookie: stateCookieHeader(state) } };
      const res = fakeResponse();

      const result = await resolveSsrSession({ req, res });

      expect(result.sessionPresent).toBe(false);
      expect(res.cookie).not.toHaveBeenCalled();
      const [rewritten] = setCookies(res);
      expect(decodeURIComponent(rewritten)).not.toContain('wrong-password');
      expect(result.homeState).toMatchObject({ loginSuccessful: false });
    });

    test('strips a stale password even when a session cookie exists', async () => {
      const state = { email, password, loginSuccessful: true };
      const req = {
        headers: {
          cookie: `${stateCookieHeader(state)}; ${SESSION_COOKIE}=${encodeURIComponent(verifiedUser.getSessionToken())}`,
        },
      };
      const res = fakeResponse();

      const result = await resolveSsrSession({ req, res });

      expect(result.sessionPresent).toBe(true);
      expect(result.homeState.password).toBeUndefined();
      const [rewritten] = setCookies(res);
      expect(decodeURIComponent(rewritten)).not.toContain(`"password"`);
    });

    test('does nothing without cookies', async () => {
      const res = fakeResponse();

      const result = await resolveSsrSession({
        req: { headers: {}, secure: false },
        res,
      });

      expect(result).toEqual({ sessionPresent: false, homeState: null });
      expect(res.cookie).not.toHaveBeenCalled();
      expect(res.append).not.toHaveBeenCalled();
    });
  });
});
