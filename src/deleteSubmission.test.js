/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * deletion and ownership-check semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import deleteSubmission from './deleteSubmission.js';

const { MongoMemoryServer } = require('mongodb-memory-server');
// parse-server is deliberately installed on demand instead of being a project
// dependency (see jest.globalSetup.js)
const { ParseServer } = require('parse-server');

// parse-server skips its cloud/URL verification (and test-unfriendly process
// listeners) when TESTING is set. Must be set before it is constructed.
process.env.TESTING = '1';

jest.setTimeout(30000);

const username = 'test@example.com';
const saveUser = jest.fn(() => Promise.resolve({ get: () => username }));

describe('deleteSubmission', () => {
  let mongo;
  let parseServer;
  let ownedSubmission;
  let iosStyleSubmission;
  let otherUsersSubmission;

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
    Parse.initialize('test-app');
    Parse.serverURL = `http://localhost:${parseServer.server.address().port}/parse`;

    const Submission = Parse.Object.extend('submission');

    ownedSubmission = new Submission();
    ownedSubmission.set('Username', username);
    ownedSubmission.set('timeofreport', new Date('2026-09-03T15:00:00.000Z'));
    await ownedSubmission.save();

    // iOS submissions don't always have Username set; the handler matches
    // them by the "email" field instead.
    iosStyleSubmission = new Submission();
    iosStyleSubmission.set('email', username);
    iosStyleSubmission.set(
      'timeofreport',
      new Date('2026-09-03T14:00:00.000Z'),
    );
    await iosStyleSubmission.save();

    otherUsersSubmission = new Submission();
    otherUsersSubmission.set('Username', 'other@example.com');
    otherUsersSubmission.set(
      'timeofreport',
      new Date('2026-09-03T13:00:00.000Z'),
    );
    await otherUsersSubmission.save();
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  const Submission = Parse.Object.extend('submission');
  const callDeleteSubmission = objectId =>
    deleteSubmission({ req: { body: { objectId } }, saveUser });

  test('deletes the submission with the given objectId', async () => {
    const result = await callDeleteSubmission(ownedSubmission.id);

    expect(saveUser).toHaveBeenCalledWith({ objectId: ownedSubmission.id });
    expect(result).toEqual({ objectId: ownedSubmission.id });

    // The submission is really gone from Parse.
    const query = new Parse.Query(Submission);
    await expect(query.get(ownedSubmission.id)).rejects.toMatchObject({
      code: 101,
    });
  });

  test('deletes iOS-style submissions matched by the email field', async () => {
    const result = await callDeleteSubmission(iosStyleSubmission.id);

    expect(result).toEqual({ objectId: iosStyleSubmission.id });

    const query = new Parse.Query(Submission);
    await expect(query.get(iosStyleSubmission.id)).rejects.toMatchObject({
      code: 101,
    });
  });

  test('rejects deleting a submission someone else made', async () => {
    await expect(
      callDeleteSubmission(otherUsersSubmission.id),
    ).rejects.toMatchObject({
      code: 'ERR_ASSERTION',
      expected: true,
    });

    // The other user's submission is still there.
    const query = new Parse.Query(Submission);
    const stillThere = await query.get(otherUsersSubmission.id);
    expect(stillThere.id).toBe(otherUsersSubmission.id);
  });
});
