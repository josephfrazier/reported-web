/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * query semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import getSubmissions from './getSubmissions.js';

const { MongoMemoryServer } = require('mongodb-memory-server');
const { ParseServer } = require('parse-server');

// parse-server skips its cloud/URL verification (and test-unfriendly process
// listeners) when TESTING is set. Must be set before it is constructed.
process.env.TESTING = '1';

jest.setTimeout(30000);

const username = 'test@example.com';
const saveUser = jest.fn(() => Promise.resolve({ get: () => username }));

describe('getSubmissions', () => {
  let mongo;
  let parseServer;
  let labelsById;

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

    // Create the newest-photo submissions FIRST and the oldest-photo ones
    // LAST, so photo time is anti-correlated with createdAt (which the server
    // sets in creation order). That is the only arrangement that distinguishes
    // "timeofreport, then createdAt, both descending" from the "createdAt
    // descending only" regression.
    const Submission = Parse.Object.extend('submission');
    const create = async ({ timeofreport, useUsername = username }) => {
      const submission = new Submission();
      if (useUsername) {
        submission.set('Username', useUsername);
      } else {
        // iOS-style submissions target the "email" field instead.
        submission.set('email', username);
      }
      submission.set('timeofreport', new Date(timeofreport));
      await submission.save();
      return submission;
    };

    const f1 = await create({ timeofreport: '2026-09-03T15:00:00.000Z' });
    const f2 = await create({ timeofreport: '2026-09-03T15:00:00.000Z' });
    const s1 = await create({
      timeofreport: '2026-09-03T14:58:00.000Z',
      useUsername: null,
    });
    const s2 = await create({ timeofreport: '2026-09-03T14:58:00.000Z' });
    labelsById = { [f1.id]: 'F1', [f2.id]: 'F2', [s1.id]: 'S1', [s2.id]: 'S2' };
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  test('sorts by photo time, breaking ties by when they were submitted', async () => {
    const results = await getSubmissions({
      req: { body: { email: username } },
      saveUser,
    });

    // F1 and F2 both have a photo timestamp of 3:00 PM; F2 was created after
    // F1, so F2 must come first. The same holds for S2/S1 at 2:58 PM.
    expect(saveUser).toHaveBeenCalledWith({ email: username });
    expect(results.map(result => labelsById[result.id])).toEqual([
      'F2',
      'F1',
      'S2',
      'S1',
    ]);
  });
});
