/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 9.4.0 (the version production will run once
 * https://github.com/josephfrazier/reported-web/pull/713 is merged) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * query and task-join semantics are exercised instead of a fake.
 */

import Parse from 'parse/node';
import getSubmissionsWithTasks from './getSubmissionsWithTasks.js';
import startRealParseServer from './testUtils/realParseServer.js';

jest.setTimeout(30000);

const username = 'test@example.com';
// Stand-in for src/session.js's authenticate: resolves the request's user.
const authenticate = jest.fn(() =>
  Promise.resolve({ user: { get: () => username } }),
);

describe('getSubmissionsWithTasks', () => {
  let stopParseServer;
  let withTasks;
  let withoutTasks;

  beforeAll(async () => {
    // The master key is passed for getSubmissions()'s listing query; the task
    // join itself runs without it, since task records carry no ACL.
    const { stop } = await startRealParseServer({
      masterKey: 'test-master',
      // parse-server 5+ defaults client class creation to off. These tests
      // save `submission`/`tasks` objects as an ordinary client, and in
      // production both classes already exist in the schema.
      serverOptions: { allowClientClassCreation: true },
    });
    stopParseServer = stop;

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

  afterAll(() => stopParseServer());

  test('returns the submissions newest-first, each with its tasks joined', async () => {
    const results = await getSubmissionsWithTasks({
      req: { body: { email: username } },
      authenticate,
    });

    expect(authenticate).toHaveBeenCalled();
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
    expect(results[1].timeofreport).toEqual(
      new Date('2026-09-03T14:00:00.000Z'),
    );
  });
});
