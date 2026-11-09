/**
 * @jest-environment node
 */

import {
  isTokenDepleted,
  markTokenAccepted,
  markTokenThrottled,
  markTokenUsed,
  markTokenDepleted,
  orderTokens,
  resetTokenPool,
  throttleMsFromResponse,
} from './alprTokenPool.js';

beforeEach(() => resetTokenPool());

describe('orderTokens', () => {
  test('keeps the configured order before any token has been used', () => {
    expect(orderTokens(['one', 'two', 'three'])).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  test('puts the token used longest ago first', () => {
    markTokenUsed('one', 1000);
    markTokenUsed('two', 3000);

    expect(orderTokens(['one', 'two', 'three'], 4000)).toEqual([
      'three',
      'one',
      'two',
    ]);
  });

  test('keeps the configured order between tokens used at the same time', () => {
    markTokenUsed('two', 1000);
    markTokenUsed('one', 1000);

    expect(orderTokens(['one', 'two'], 2000)).toEqual(['one', 'two']);
  });

  test('puts a throttled token behind a free one that was used later', () => {
    markTokenUsed('one', 1000);
    markTokenUsed('two', 3000);
    markTokenThrottled('one', 5000, 4000);

    expect(orderTokens(['one', 'two'], 5000)).toEqual(['two', 'one']);
  });

  test('puts the token free soonest first when all are throttled', () => {
    markTokenThrottled('one', 5000, 0);
    markTokenThrottled('two', 1000, 0);

    expect(orderTokens(['one', 'two'], 500)).toEqual(['two', 'one']);
  });

  test('treats a token as free once its wait has passed', () => {
    markTokenUsed('one', 1000);
    markTokenUsed('two', 4000);
    markTokenThrottled('two', 1000, 4000);

    expect(orderTokens(['one', 'two'], 5000)).toEqual(['one', 'two']);
  });

  test('frees a token that answered after an earlier throttle', () => {
    markTokenThrottled('one', 60_000);
    markTokenAccepted('one');
    markTokenUsed('two', 1000);

    expect(orderTokens(['one', 'two'], 2000)).toEqual(['one', 'two']);
  });

  test('leaves out a token that is depleted', () => {
    markTokenDepleted('one');

    expect(orderTokens(['one', 'two', 'three'], 0)).toEqual(['two', 'three']);
  });
});

describe('depleted tokens', () => {
  test('stays depleted until the pool is reset', () => {
    markTokenDepleted('one');

    expect(isTokenDepleted('one')).toBe(true);
    expect(isTokenDepleted('two')).toBe(false);

    resetTokenPool();

    expect(isTokenDepleted('one')).toBe(false);
    expect(orderTokens(['one'], 0)).toEqual(['one']);
  });
});

// Stands in for a fetch Response: the wait is in the header or the body, and
// the body is read through clone() the way the real one is.
function responseWith({ headers = {}, body } = {}) {
  return {
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    clone: () => ({ json: async () => body }),
  };
}

describe('throttleMsFromResponse', () => {
  test('takes the wait from a Retry-After header in seconds', async () => {
    const response = responseWith({ headers: { 'retry-after': '3' } });

    await expect(throttleMsFromResponse(response)).resolves.toBe(3000);
  });

  test('takes the wait from a Retry-After header holding a date', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const response = responseWith({
      headers: { 'retry-after': new Date(now + 7000).toUTCString() },
    });

    await expect(throttleMsFromResponse(response, now)).resolves.toBe(7000);
  });

  test('takes the wait from the body when there is no header', async () => {
    const response = responseWith({
      body: {
        detail: 'Request was throttled. Expected available in 2.5 seconds.',
        status_code: 429,
      },
    });

    await expect(throttleMsFromResponse(response)).resolves.toBe(2500);
  });

  test('uses a second when the response gives no wait', async () => {
    const response = responseWith({
      body: { detail: 'Request was throttled.' },
    });

    await expect(throttleMsFromResponse(response)).resolves.toBe(1000);
  });

  test('uses a second when the body cannot be read', async () => {
    const response = {
      headers: { get: () => null },
      clone: () => ({
        json: async () => {
          throw new Error('body already read');
        },
      }),
    };

    await expect(throttleMsFromResponse(response)).resolves.toBe(1000);
  });
});
