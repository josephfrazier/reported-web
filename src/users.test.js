/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 9.4.0 (the version production will run once
 * https://github.com/josephfrazier/reported-web/pull/713 is merged) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * sign-up/log-in semantics are exercised instead of a fake.
 */

import Parse from 'parse/node';
import { logIn, updateUserProfile } from './users.js';
import startRealParseServer from './testUtils/realParseServer.js';

jest.setTimeout(30000);

const email = 'test@example.com';
const password = 'test-password';

describe('users', () => {
  let stopParseServer;
  let verifiedUser;

  beforeAll(async () => {
    // The master key is passed only for the seeding save below: parse-server
    // treats emailVerified as a protected field that no client may set on
    // itself. The modules under test need no master key: logIn() and
    // updateUserProfile() authorize with the session token logIn() returns.
    const { stop } = await startRealParseServer({
      masterKey: 'test-master',
      serverOptions: {
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
    });
    stopParseServer = stop;

    // Parse Server leaves emailVerified unset on signUp, and logIn()
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

  afterAll(() => stopParseServer());

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
      can_be_shared_publicly: false,
    });

    expect(saved.id).toBe(verifiedUser.id);
    expect(saved.toJSON()).toMatchObject({
      useremail: email,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
      // Always stored, like testify: the native app reads a default of
      // true when the field is absent, so false must be explicit.
      can_be_shared_publicly: false,
    });
  });

  test('updateUserProfile stores the sparse NYPD flags only when true', async () => {
    const user = await logIn({ email, password });
    const sessionToken = user.getSessionToken();
    const base = {
      user,
      sessionToken,
      email,
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    };
    const exerciseSparseFlag = async flag => {
      // true: stored on the user...
      await updateUserProfile({ ...base, [flag]: true });
      expect(user.get(flag)).toBe(true);

      // false: unset, so non-opt-ins don't carry the field...
      await updateUserProfile({ ...base, [flag]: false });
      expect(user.get(flag)).toBeUndefined();

      // ...and absent: left alone, so clients that don't know about the
      // flag don't clobber a previous opt-in.
      await updateUserProfile({ ...base, [flag]: true });
      await updateUserProfile(base);
      expect(user.get(flag)).toBe(true);
    };

    await exerciseSparseFlag('withhold_contact_info_from_nypd');
    await exerciseSparseFlag('receive_nypd_sr_updates_by_email');
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
