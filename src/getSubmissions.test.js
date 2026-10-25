/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 9.4.0 (the version production will run once
 * https://github.com/josephfrazier/reported-web/pull/713 is merged) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * query semantics are exercised instead of a fake.
 */

import Parse from 'parse/node';
import getSubmissions from './getSubmissions.js';
import startRealParseServer from './testUtils/realParseServer.js';

jest.setTimeout(30000);

const username = 'test@example.com';
// Stand-in for src/session.js's authenticate: resolves the request's user.
const authenticate = jest.fn(() =>
  Promise.resolve({ user: { get: () => username } }),
);

describe('getSubmissions', () => {
  let stopParseServer;
  let labelsById;
  let emailAccount;
  let emailOnlySubmission;
  let pointerAccount;
  let pointerOnlySubmission;

  beforeAll(async () => {
    // getSubmissions() lists with the master key, because submissions made by
    // the mobile clients belong to a different Parse user with the same email
    // address (see the test's iOS-style entries below), so it is passed here.
    const { stop } = await startRealParseServer({
      masterKey: 'test-master',
      // parse-server 5+ defaults client class creation to off. These tests
      // save `submission`/`tasks` objects as an ordinary client, and in
      // production both classes already exist in the schema.
      serverOptions: { allowClientClassCreation: true },
    });
    stopParseServer = stop;

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

    // The mobile clients create accounts whose username is not the address
    // that ends up on their reports (their email is). This is one of those
    // accounts, and a report carrying its email address.
    emailAccount = new Parse.User();
    emailAccount.setUsername('mobile-account');
    emailAccount.set('email', 'reports@example.com');
    emailAccount.setPassword('password');
    await emailAccount.signUp();

    emailOnlySubmission = new Submission();
    emailOnlySubmission.set('Username', 'reports@example.com');
    emailOnlySubmission.set(
      'timeofreport',
      new Date('2026-09-03T13:00:00.000Z'),
    );
    await emailOnlySubmission.save();

    // A native-client report: the `user` pointer, and neither address field,
    // so only the pointer can find it.
    pointerAccount = new Parse.User();
    pointerAccount.setUsername('pointer-account');
    pointerAccount.setPassword('password');
    await pointerAccount.signUp();

    pointerOnlySubmission = new Submission();
    pointerOnlySubmission.set('user', pointerAccount);
    pointerOnlySubmission.set(
      'timeofreport',
      new Date('2026-09-03T12:00:00.000Z'),
    );
    await pointerOnlySubmission.save();
  });

  afterAll(() => stopParseServer());

  test('sorts by photo time, breaking ties by when they were submitted', async () => {
    const results = await getSubmissions({
      req: { body: { email: username } },
      authenticate,
    });

    // F1 and F2 both have a photo timestamp of 3:00 PM; F2 was created after
    // F1, so F2 must come first. The same holds for S2/S1 at 2:58 PM.
    expect(authenticate).toHaveBeenCalled();
    expect(results.map(result => labelsById[result.id])).toEqual([
      'F2',
      'F1',
      'S2',
      'S1',
    ]);
  });

  test("matches the account's email as well as its username", async () => {
    const results = await getSubmissions({
      req: { body: {} },
      authenticate: () => Promise.resolve({ user: emailAccount }),
    });

    // Only the report carrying the account's email comes back; the entries
    // above use a different address, and emailAccount's username (which no
    // submission carries) must not matter.
    expect(results.map(result => result.id)).toEqual([emailOnlySubmission.id]);
  });

  test('matches a submission by its user pointer when it has no address fields', async () => {
    const results = await getSubmissions({
      req: { body: {} },
      authenticate: () => Promise.resolve({ user: pointerAccount }),
    });

    expect(results.map(result => result.id)).toEqual([
      pointerOnlySubmission.id,
    ]);
  });
});
