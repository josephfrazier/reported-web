/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * query and task-join semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import getSubmissionsWithTasks from './getSubmissionsWithTasks.js';

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

describe('getSubmissionsWithTasks', () => {
  let mongo;
  let parseServer;
  let withTasks;
  let withoutTasks;

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
    // The photo timestamps keep withTasks newer than withoutTasks, so the
    // submissions come back in a known order.
    withTasks = new Submission();
    withTasks.set('Username', username);
    withTasks.set('timeofreport', new Date('2026-09-03T15:00:00.000Z'));
    await withTasks.save();

    withoutTasks = new Submission();
    withoutTasks.set('Username', username);
    withoutTasks.set('timeofreport', new Date('2026-09-03T14:00:00.000Z'));
    await withoutTasks.save();

    const Task = Parse.Object.extend('tasks');
    const createTask = async ({
      submission,
      action,
      // The Parse field is named in snake_case, like prod's task records.
      case_id, // eslint-disable-line camelcase
    }) => {
      const task = new Task();
      task.set('submission', submission);
      task.set('action', action);
      task.set('case_id', case_id);
      await task.save();
      return task;
    };
    await createTask({
      submission: withTasks,
      action: 'submit 311 complaint',
      case_id: 'TLC-12345',
    });
    await createTask({
      submission: withTasks,
      action: 'submit 311 illegal parking complaint',
      case_id: 'NYPD-12345',
    });
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  test('returns the submissions newest-first, each with its tasks joined', async () => {
    const results = await getSubmissionsWithTasks({
      req: { body: { email: username } },
      saveUser,
    });

    expect(saveUser).toHaveBeenCalledWith({ email: username });
    expect(results).toHaveLength(2);

    expect(results[0]).toMatchObject({
      objectId: withTasks.id,
      Username: username,
      tasks: [
        {
          objectId: expect.any(String),
          action: 'submit 311 complaint',
          case_id: 'TLC-12345',
        },
        {
          objectId: expect.any(String),
          action: 'submit 311 illegal parking complaint',
          case_id: 'NYPD-12345',
        },
      ],
    });
    expect(results[0].timeofreport).toEqual(
      new Date('2026-09-03T15:00:00.000Z'),
    );
    // The task's `submission` pointer comes back as the raw Parse object the
    // route relies on res.json to serialize.
    results[0].tasks.forEach(task => {
      expect(task.submission.id).toBe(withTasks.id);
    });

    expect(results[1]).toMatchObject({
      objectId: withoutTasks.id,
      Username: username,
      tasks: [],
    });
  });
});
