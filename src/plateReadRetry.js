import axiosRetry from 'axios-retry';

// What a plate read is worth repeating for, as `axios-retry` options.
//
// Kept out of the call site so a test can drive a real axios instance through
// the same options: mocking `axios.post` replaces the very method whose
// interceptor chain does the retrying, so a mocked call exercises none of this.
export default {
  retries: 3, // four attempts in all, the first one included

  // The library's default condition repeats a network error or a request whose
  // method is idempotent. A plate read is a POST, so it is neither, and a 429
  // is a response rather than a network error -- without this the retry never
  // runs at all.
  retryCondition: axiosRetry.isRetryableError,

  // 429 is the status that actually happens here: Plate Recognizer rate limits.
  // The library's default factor is 100ms, which spends its attempts inside the
  // limit that was just tripped. The library counts the retry before calling
  // this, so the first wait is the second power of the factor: 1s, doubling.
  retryDelay: (retryCount, error) =>
    axiosRetry.exponentialDelay(retryCount - 1, error, 1000),

  onRetry: (retryCount, error) =>
    console.info(`/platerecognizer failed, retrying (attempt ${retryCount})`, {
      error,
    }),
};
