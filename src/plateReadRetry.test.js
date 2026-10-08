// Tests of what `plateReadRetry` asks `axios-retry` for, rather than tests of
// the library: whether it repeats a request at all is the condition's doing,
// and how long it waits is the delay's. Both are ours, and neither is the
// library's default.
//
// They are also the only coverage this has. The rest of the suite mocks
// `axios.post`, which replaces the method whose interceptor chain does the
// retrying, so nothing else reaches it -- a configuration that quietly stopped
// working would pass everywhere else.
import axios from 'axios';
import axiosRetry from 'axios-retry';
import plateReadRetry from './plateReadRetry.js';

// A stand-in for the network. It answers each attempt with the next status in
// `answers`, repeating the last one, and records the requests it was given.
//
// These drive a real axios instance rather than a mocked `axios.post`, because
// the retrying happens in the instance's interceptor chain -- a mock replaces
// the method that runs it, so the retry would never be reached.
const adapterFor = answers => {
  const requests = [];

  const adapter = config => {
    requests.push(config);
    const status = answers[Math.min(requests.length - 1, answers.length - 1)];
    const response = {
      status,
      statusText: `${status}`,
      headers: {},
      data: { id: 'read' },
      config,
    };

    return status >= 200 && status < 300
      ? Promise.resolve(response)
      : Promise.reject(
          Object.assign(new Error(`status ${status}`), { config, response }),
        );
  };

  return { adapter, requests };
};

// The instance as `Home.js` leaves it: interceptors installed, no retry of its
// own, every request deciding for itself.
const attachedInstance = () => {
  const instance = axios.create();
  axiosRetry(instance, { retries: 0 });
  return instance;
};

describe('the plate read retry', () => {
  // The waits are real timers in the library, so they are advanced rather than
  // waited out. They carry up to 20% jitter, hence the round numbers.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('repeats a rate limit and returns the read that follows', async () => {
    const { adapter, requests } = adapterFor([429, 429, 200]);
    const instance = attachedInstance();

    const read = instance.post('/platerecognizer', null, {
      adapter,
      'axios-retry': plateReadRetry,
    });

    await jest.advanceTimersByTimeAsync(1500); // past the first wait
    await jest.advanceTimersByTimeAsync(3000); // past the second

    await expect(read).resolves.toMatchObject({ status: 200 });
    expect(requests).toHaveLength(3);
  });

  test('waits a second, then two, then four', () => {
    // The library counts the retry before asking for the wait, so it asks with
    // 1 on the first retry -- hence the correction inside `retryDelay`. Each
    // wait carries up to 20% jitter on top of its base.
    [1, 2, 3].forEach(retryCount => {
      const base = 1000 * 2 ** (retryCount - 1);
      const wait = plateReadRetry.retryDelay(retryCount, undefined);

      expect(wait).toBeGreaterThanOrEqual(base);
      expect(wait).toBeLessThanOrEqual(base * 1.2);
    });
  });

  test('does not repeat a refusal the request itself caused', async () => {
    const { adapter, requests } = adapterFor([400]);
    const instance = attachedInstance();

    await expect(
      instance.post('/platerecognizer', null, {
        adapter,
        'axios-retry': plateReadRetry,
      }),
    ).rejects.toThrow('status 400');

    expect(requests).toHaveLength(1);
  });

  test('leaves a request that did not ask for a retry alone', async () => {
    const { adapter, requests } = adapterFor([500, 200]);
    const instance = attachedInstance();

    await expect(instance.post('/submit', null, { adapter })).rejects.toThrow(
      'status 500',
    );

    expect(requests).toHaveLength(1);
  });
});
