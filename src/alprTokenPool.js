/**
 * Decides the order in which a plate read tries its Plate Recognizer tokens.
 *
 * Plate Recognizer rate limits each token separately, by the second. A read
 * that always starts with the first token sends every call to one account
 * until the service throttles it, while the other tokens sit idle. This module
 * records when each token was last used, so the token used longest ago comes
 * first. A fresh process has no history, and then the order matches the
 * configured list.
 *
 * A 429 response says the token is throttled, and Plate Recognizer names the
 * wait in the response body: "Expected available in 1 second." That time is
 * recorded, and a throttled token sorts behind every token that is free. When
 * every token is throttled, the one free soonest goes first, because the read
 * still has to try one of them.
 *
 * The history is a few Maps in this process's memory. A second process keeps
 * its own, so two dynos can still choose the same token at the same moment.
 */

const lastUsedAt = new Map();
const throttledUntil = new Map();

// How long to leave a throttled token alone when the response gives no usable
// wait. Plate Recognizer limits calls by the second, so one second covers the
// wait the service documents.
const DEFAULT_THROTTLE_MS = 1000;

export function orderTokens(tokens, now = Date.now()) {
  return tokens
    .map((token, index) => ({
      token,
      index,
      lastUsedAt: lastUsedAt.get(token) ?? 0,
      throttledUntil: throttledUntil.get(token) ?? 0,
    }))
    .sort((a, b) => {
      const aIsThrottled = a.throttledUntil > now;
      const bIsThrottled = b.throttledUntil > now;

      // A token the service refused is the last one to spend a call on.
      if (aIsThrottled !== bIsThrottled) {
        return aIsThrottled ? 1 : -1;
      }

      if (aIsThrottled) {
        return a.throttledUntil - b.throttledUntil || a.index - b.index;
      }

      return a.lastUsedAt - b.lastUsedAt || a.index - b.index;
    })
    .map(({ token }) => token);
}

// Records that a call is about to go out with this token. It is marked at the
// start, not at the answer: two reads that begin together must not both
// choose the same idle token.
export function markTokenUsed(token, now = Date.now()) {
  lastUsedAt.set(token, now);
}

// A token that answered is not throttled any more, whatever an earlier 429
// said about it.
export function markTokenAccepted(token) {
  throttledUntil.delete(token);
}

export function markTokenThrottled(token, waitMs, now = Date.now()) {
  throttledUntil.set(token, now + waitMs);
}

// The wait a 429 asks for, in milliseconds. A Retry-After header wins, since
// it is the standard place to say it; the body's "Expected available in N
// seconds." is what Plate Recognizer documents. A response with neither
// leaves the default wait.
export async function throttleMsFromResponse(response, now = Date.now()) {
  const retryAfter = response.headers?.get?.('retry-after');

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - now);
    }
  }

  try {
    const body = await response.clone().json();
    const match = /available in\s+([\d.]+)\s+seconds?/i.exec(
      body?.detail || '',
    );
    if (match) {
      return Math.ceil(Number(match[1]) * 1000);
    }
  } catch {
    // A response that cannot be read leaves the default wait below.
  }

  return DEFAULT_THROTTLE_MS;
}

// Tests share this module's state across cases, so they clear it first.
export function resetTokenPool() {
  lastUsedAt.clear();
  throttledUntil.clear();
}
