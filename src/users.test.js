/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * sign-up/log-in semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import { logIn, saveUser } from './users.js';

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
      },
      () => {},
    );
    await new Promise((resolve, reject) => {
      parseServer.server.once('listening', resolve);
      parseServer.server.once('error', reject);
    });
    // parse-server initializes its own nested parse SDK; ours needs it too.
    // The master key is passed like prod's Parse.initialize() does, and
    // server.js's import-time useMasterKey() call is mirrored, so the
    // modules under test see the master key on their requests like in prod.
    // (Only the master key lets parse-server accept an emailVerified update.)
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
    // logIn() re-sets the email (to trigger a verification email) and throws.
    await expect(
      logIn({ email: 'unverified@example.com', password }),
    ).rejects.toMatchObject({
      message:
        'We just sent you an email with a link to confirm your address, please find and click that.',
    });
  });

  test('logIn rejects a wrong password', async () => {
    await expect(
      logIn({ email, password: 'wrong-password' }),
    ).rejects.toMatchObject({ code: 101 });
  });

  test('saveUser saves the profile fields onto the logged-in user', async () => {
    const user = await saveUser({
      email,
      password,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    });

    expect(user.id).toBe(verifiedUser.id);
    expect(user.toJSON()).toMatchObject({
      useremail: email,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    });
  });

  test('saveUser rejects when a required field is missing', async () => {
    await expect(
      saveUser({
        email,
        password,
        FirstName: '',
        LastName: 'User',
        Phone: '5551234567',
        testify: true,
      }),
    ).rejects.toMatchObject({ message: 'FirstName is required' });
  });
});
