import retryTransientRequest, { isRetryable } from './retryTransientRequest.js';

const failureWithStatus = status => {
  const error = new Error(`request failed with ${status}`);
  error.response = { status };
  return error;
};

describe('isRetryable', () => {
  test.each([408, 425, 429, 500, 502, 503, 504])(
    'repeats a %p',
    status => {
      expect(isRetryable(failureWithStatus(status))).toBe(true);
    },
  );

  test.each([400, 401, 403, 404, 413, 422])(
    'does not repeat a %p, which would get the same answer',
    status => {
      expect(isRetryable(failureWithStatus(status))).toBe(false);
    },
  );

  test('repeats a request that never got a response at all', () => {
    expect(isRetryable(new Error('socket hang up'))).toBe(true);
  });
});

describe('retryTransientRequest', () => {
  // Delays are recorded rather than waited out.
  const recorder = () => {
    const slept = [];
    return {
      slept,
      sleep: async ms => {
        slept.push(ms);
      },
    };
  };

  test('returns the first successful result without retrying', async () => {
    const send = jest.fn().mockResolvedValue({ id: 'first' });
    const { slept, sleep } = recorder();

    await expect(retryTransientRequest({ send, sleep })).resolves.toEqual({
      id: 'first',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  test('retries a rate limit and returns the result once it succeeds', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(failureWithStatus(429))
      .mockRejectedValueOnce(failureWithStatus(429))
      .mockResolvedValue({ id: 'third' });
    const { slept, sleep } = recorder();
    const retries = [];

    await expect(
      retryTransientRequest({ send, sleep, onRetry: r => retries.push(r) }),
    ).resolves.toEqual({ id: 'third' });

    expect(send).toHaveBeenCalledTimes(3);
    // Doubling, so a rate-limited batch spreads its retries rather than
    // adding to the burst.
    expect(slept).toEqual([1000, 2000]);
    expect(retries.map(r => r.attempt)).toEqual([1, 2]);
    expect(retries[0].retryInMs).toBe(1000);
  });

  test('gives up after the last attempt and rethrows the failure', async () => {
    const failure = failureWithStatus(429);
    const send = jest.fn().mockRejectedValue(failure);
    const { slept, sleep } = recorder();

    await expect(
      retryTransientRequest({ send, sleep, attempts: 3 }),
    ).rejects.toBe(failure);

    expect(send).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([1000, 2000]);
  });

  test('does not wait through retries for an error a repeat cannot fix', async () => {
    const failure = failureWithStatus(403);
    const send = jest.fn().mockRejectedValue(failure);
    const { slept, sleep } = recorder();

    await expect(retryTransientRequest({ send, sleep })).rejects.toBe(failure);

    expect(send).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  test('honours the attempt count and base delay it is given', async () => {
    const send = jest.fn().mockRejectedValue(failureWithStatus(503));
    const { slept, sleep } = recorder();

    await expect(
      retryTransientRequest({ send, sleep, attempts: 2, baseDelayMs: 250 }),
    ).rejects.toThrow('503');

    expect(send).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([250]);
  });
});
