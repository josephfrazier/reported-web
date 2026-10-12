/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 9.4.0 (the version production will run once
 * https://github.com/josephfrazier/reported-web/pull/713 is merged) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * deletion and ownership-check semantics are exercised instead of a fake.
 */

import Parse from 'parse/node';
import stringify from 'json-stringify-safe';

import deleteSubmission from './deleteSubmission.js';
import startRealParseServer from './testUtils/realParseServer.js';

jest.setTimeout(30000);

const username = 'test@example.com';
// Stand-in for src/session.js's authenticate: resolves the request's user.
const authenticate = jest.fn(() =>
  Promise.resolve({ user: { get: () => username } }),
);

describe('deleteSubmission', () => {
  let stopParseServer;
  let ownedSubmission;
  let iosStyleSubmission;
  let otherUsersSubmission;
  let emailAccount;
  let emailOwnedSubmission;
  let pointerAccount;
  let pointerOnlySubmission;

  beforeAll(async () => {
    // deleteSubmission() fetches and destroys with the master key, because a
    // submission made by the mobile client belongs to a different Parse user
    // (see the iOS-style entry below), so it is passed here.
    const { stop } = await startRealParseServer({
      masterKey: 'test-master',
      // parse-server 5+ defaults client class creation to off. These tests
      // save `submission`/`tasks` objects as an ordinary client, and in
      // production both classes already exist in the schema.
      serverOptions: { allowClientClassCreation: true },
    });
    stopParseServer = stop;

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

    // The mobile clients create accounts whose username is not the address
    // that ends up on their reports (their email is). The ownership check
    // must accept the account's email too, so this report is deletable.
    emailAccount = new Parse.User();
    emailAccount.setUsername('mobile-account');
    emailAccount.set('email', 'reports@example.com');
    emailAccount.setPassword('password');
    await emailAccount.signUp();

    emailOwnedSubmission = new Submission();
    emailOwnedSubmission.set('Username', 'reports@example.com');
    emailOwnedSubmission.set(
      'timeofreport',
      new Date('2026-09-03T12:00:00.000Z'),
    );
    await emailOwnedSubmission.save();

    // A native-client report: the `user` pointer, and neither address field.
    pointerAccount = new Parse.User();
    pointerAccount.setUsername('pointer-account');
    pointerAccount.setPassword('password');
    await pointerAccount.signUp();

    pointerOnlySubmission = new Submission();
    pointerOnlySubmission.set('user', pointerAccount);
    pointerOnlySubmission.set(
      'timeofreport',
      new Date('2026-09-03T11:00:00.000Z'),
    );
    await pointerOnlySubmission.save();
  });

  afterAll(() => stopParseServer());

  const Submission = Parse.Object.extend('submission');
  const callDeleteSubmission = objectId =>
    deleteSubmission({ req: { body: { objectId } }, authenticate });

  test('deletes the submission with the given objectId', async () => {
    const result = await callDeleteSubmission(ownedSubmission.id);

    expect(authenticate).toHaveBeenCalled();
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

  test("deletes a submission that carries the account's email, not its username", async () => {
    const result = await deleteSubmission({
      req: { body: { objectId: emailOwnedSubmission.id } },
      authenticate: () => Promise.resolve({ user: emailAccount }),
    });

    expect(result).toEqual({ objectId: emailOwnedSubmission.id });

    const query = new Parse.Query(Submission);
    await expect(query.get(emailOwnedSubmission.id)).rejects.toMatchObject({
      code: 101,
    });
  });

  test("does not treat another account's pointer as ownership", async () => {
    await expect(
      deleteSubmission({
        req: { body: { objectId: pointerOnlySubmission.id } },
        authenticate: () => Promise.resolve({ user: emailAccount }),
      }),
    ).rejects.toMatchObject({
      message: 'the submission was not found or was not made by this user',
    });

    // The other account's submission is still there.
    const query = new Parse.Query(Submission);
    const stillThere = await query.get(pointerOnlySubmission.id);
    expect(stillThere.id).toBe(pointerOnlySubmission.id);
  });

  test('deletes a submission matched by its user pointer without address fields', async () => {
    const result = await deleteSubmission({
      req: { body: { objectId: pointerOnlySubmission.id } },
      authenticate: () => Promise.resolve({ user: pointerAccount }),
    });

    expect(result).toEqual({ objectId: pointerOnlySubmission.id });

    const query = new Parse.Query(Submission);
    await expect(query.get(pointerOnlySubmission.id)).rejects.toMatchObject({
      code: 101,
    });
  });

  test('rejects deleting a submission someone else made', async () => {
    await expect(
      callDeleteSubmission(otherUsersSubmission.id),
    ).rejects.toMatchObject({
      message: 'the submission was not found or was not made by this user',
    });

    // The other user's submission is still there.
    const query = new Parse.Query(Submission);
    const stillThere = await query.get(otherUsersSubmission.id);
    expect(stillThere.id).toBe(otherUsersSubmission.id);
  });

  test('rejects a nonexistent submission id the same way', async () => {
    const [someoneElsesError, nonexistentError] = await Promise.all([
      callDeleteSubmission(otherUsersSubmission.id).catch(error => error),
      callDeleteSubmission('aaaaaaaaaa').catch(error => error),
    ]);

    // A different response for nonexistent ids would let anyone confirm that
    // someone else's objectId refers to a real submission, so both cases must
    // look identical after handlePromiseRejection's stringify round-trip.
    expect(JSON.parse(stringify({ error: nonexistentError }))).toEqual(
      JSON.parse(stringify({ error: someoneElsesError })),
    );
  });
});
