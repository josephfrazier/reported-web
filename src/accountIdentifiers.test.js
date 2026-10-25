/**
 * @jest-environment node
 */

import accountIdentifiers from './accountIdentifiers.js';

const userWith = fields => ({
  get: key => fields[key],
});

describe('accountIdentifiers', () => {
  test('returns the username and the email, in that order', () => {
    expect(
      accountIdentifiers(
        userWith({ username: 'mobile-account', email: 'report@example.com' }),
      ),
    ).toEqual(['mobile-account', 'report@example.com']);
  });

  test('omits an absent email (older accounts may not have one)', () => {
    expect(accountIdentifiers(userWith({ username: 'a@example.com' }))).toEqual(
      ['a@example.com'],
    );
  });

  test('does not repeat an email that is also the username', () => {
    expect(
      accountIdentifiers(
        userWith({ username: 'a@example.com', email: 'a@example.com' }),
      ),
    ).toEqual(['a@example.com']);
  });
});
