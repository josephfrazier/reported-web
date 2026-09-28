// Statuses worth sending the same request again for: the server understood it
// and the same one is likely to succeed shortly afterwards.
//
// 429 is the one that actually happens here. A batch sends one request per
// photo, three at a time, and Plate Recognizer rate limits that -- so a
// retried request is often the difference between a plate read and a photo the
// user has to type in by hand. The 5xx entries are the same reasoning: nothing
// about the request was wrong.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const statusOf = error => error?.response?.status;

const sleepFor = ms => new Promise(resolve => setTimeout(resolve, ms));

// Whether a failed request is worth repeating.
//
// A response the server understood and refused -- a bad token, an image it
// will not accept -- is not: sending it again gets the same answer, and the
// caller should see the error rather than wait through retries for it.
export const isRetryable = error => {
  const status = statusOf(error);

  // No response at all means the request never completed, which is the most
  // retryable case there is.
  return status === undefined || RETRYABLE_STATUSES.has(status);
};

// Send something, trying again while the failure looks transient.
//
// The delay doubles between attempts, so a batch that has tripped a rate limit
// spreads its retries out instead of adding to the burst that caused it.
export default async function retryTransientRequest({
  send,
  attempts = 4,
  baseDelayMs = 1000,
  onRetry,
  sleep = sleepFor,
}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) {
        throw error;
      }

      const retryInMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry?.({ attempt, error, retryInMs });

      // eslint-disable-next-line no-await-in-loop -- waiting between attempts is the point.
      await sleep(retryInMs);
    }
  }
}
