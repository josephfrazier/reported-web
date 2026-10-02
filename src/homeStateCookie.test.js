/**
 * @jest-environment node
 */

import {
  HOME_STATE_COOKIE,
  HOME_STATE_MAX_AGE,
  parseHomeState,
  serializeHomeState,
  withoutPassword,
} from './homeStateCookie.js';

describe('homeStateCookie', () => {
  test('round-trips a state object', () => {
    const state = { email: 'a@example.com', plate: 'ABC1234' };
    const cookieHeader = serializeHomeState(state, { secure: true });

    expect(cookieHeader).toContain(`${HOME_STATE_COOKIE}=`);
    expect(cookieHeader).toContain('Path=/');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Secure');
    expect(cookieHeader).toContain(`Max-Age=${HOME_STATE_MAX_AGE}`);
    expect(parseHomeState(cookieHeader)).toEqual(state);
  });

  test('parses a state cookie out of a larger header', () => {
    const header = `other=1; ${serializeHomeState({ email: 'a@example.com' })}`;

    expect(parseHomeState(header)).toEqual({ email: 'a@example.com' });
  });

  test('treats a missing or corrupt cookie as no state', () => {
    expect(parseHomeState('')).toBeNull();
    expect(parseHomeState('other=1')).toBeNull();
    expect(parseHomeState(`${HOME_STATE_COOKIE}=not-json`)).toBeNull();
  });

  test('withoutPassword drops the password and keeps the rest', () => {
    const state = {
      email: 'a@example.com',
      password: 'hunter2',
      loginSuccessful: true,
    };

    expect(withoutPassword(state)).toEqual({
      email: 'a@example.com',
      loginSuccessful: true,
    });
    // The original is untouched.
    expect(state.password).toBe('hunter2');
  });
});
