/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * sign-up/log-in semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import { logIn, updateUserProfile } from './users.js';

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

describe('users', () => {
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
        // Production requires a verified address and refuses to log in
        // without one. In that configuration sign-up returns no session
        // token at all (parse-server's RestWrite#createSessionTokenIfNeeded),
        // which is what makes logIn() skip its verification-email resend.
        verifyUserEmails: true,
        preventLoginWithUnverifiedEmail: true,
        appName: 'test',
        publicServerURL: 'http://localhost/parse',
        // Nothing reads the mail; the calls just have to succeed.
        emailAdapter: { sendMail: () => Promise.resolve() },
      },
      () => {},
    );
    await new Promise((resolve, reject) => {
      parseServer.server.once('listening', resolve);
      parseServer.server.once('error', reject);
    });
    // parse-server initializes its own nested parse SDK; ours needs it too.
    // The master key is passed only for the seeding save below: parse-server
    // treats emailVerified as a protected field that no client may set on
    // itself. The modules under test need no master key: logIn() and
    // updateUserProfile() authorize with the session token logIn() returns.
    Parse.initialize('test-app', undefined, 'test-master');
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
    await verifiedUser.save(null, { useMasterKey: true });
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  test('logIn returns the existing verified user', async () => {
    const user = await logIn({ email, password });

    expect(user.id).toBe(verifiedUser.id);
    expect(user.toJSON()).toMatchObject({
      username: email,
      email,
      emailVerified: true,
    });
  });

  test('logIn refuses a user that signed up but has not verified their email', async () => {
    // signUp() succeeds for the new address, but emailVerified is unset, so
    // logIn() throws the "check your email" error.
    await expect(
      logIn({ email: 'unverified@example.com', password }),
    ).rejects.toMatchObject({
      message:
        'We just sent you an email with a link to confirm your address, please find and click that.',
    });
  });

  test('an unverified signup leaves no unauthenticated save behind', async () => {
    // The verification-email resend writes to the user's own _User row, and
    // with preventLoginWithUnverifiedEmail sign-up hands back no session
    // token to authorize it. Sending it anyway comes back as a 206, "Cannot
    // modify user", whose rejection exits the process.
    const save = jest.spyOn(Parse.User.prototype, 'save');

    await expect(
      logIn({ email: 'unverified-resend@example.com', password }),
    ).rejects.toMatchObject({
      message:
        'We just sent you an email with a link to confirm your address, please find and click that.',
    });

    // signUp() saves with only an installationId; the resend would be the
    // one call naming a sessionToken, and without a token it must not happen.
    const resends = save.mock.calls.filter(
      ([, options]) => options && 'sessionToken' in options,
    );
    save.mockRestore();
    expect(resends).toEqual([]);
  });

  test('logIn rejects a wrong password', async () => {
    await expect(
      logIn({ email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 101 });
  });

  test('updateUserProfile saves the fields with the session token', async () => {
    const user = await logIn({ email, password });

    const saved = await updateUserProfile({
      user,
      sessionToken: user.getSessionToken(),
      email,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    });

    expect(saved.id).toBe(verifiedUser.id);
    expect(saved.toJSON()).toMatchObject({
      useremail: email,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    });
  });

  test('updateUserProfile rejects when a required field is missing', async () => {
    const user = await logIn({ email, password });

    await expect(
      updateUserProfile({
        user,
        sessionToken: user.getSessionToken(),
        email,
        FirstName: 'Test',
        LastName: '',
        Phone: '5551234567',
        testify: true,
      }),
    ).rejects.toMatchObject({ message: 'LastName is required' });
  });
});
