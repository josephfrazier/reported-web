/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * log-in semantics are exercised instead of a fake. Files are written to the
 * real temp-dir attachment store (see src/attachmentStore.js).
 */

import crypto from 'crypto';
import net from 'net';

import Parse from 'parse/node';
import uploadAttachment from './uploadAttachment.js';
import { readAttachment } from './attachmentStore.js';

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

describe('uploadAttachment', () => {
  let mongo;
  let parseServer;

  const buffer = Buffer.from('attachment bytes');

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
    const user = new Parse.User();
    user.setUsername(email);
    user.set('email', email);
    user.setPassword(password);
    await user.signUp();
    user.set('emailVerified', true);
    await user.save(null, { sessionToken: user.getSessionToken() });
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  test('stores the file under its SHA-256 hash and returns that id', async () => {
    const id = await uploadAttachment({ email, password, buffer });

    expect(id).toBe(crypto.createHash('sha256').update(buffer).digest('hex'));
    expect(await readAttachment(id)).toEqual(buffer);
  });

  test('rejects a wrong password without storing anything', async () => {
    const neverWrittenBuffer = Buffer.from('never written');

    await expect(
      uploadAttachment({
        email,
        password: 'wrong-password',
        buffer: neverWrittenBuffer,
      }),
    ).rejects.toMatchObject({ code: 101 });

    const id = crypto
      .createHash('sha256')
      .update(neverWrittenBuffer)
      .digest('hex');
    expect(await readAttachment(id)).toBeNull();
  });
});
