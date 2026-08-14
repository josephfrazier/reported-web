/**
 * Cache of the current user's most recent submissions in localStorage.
 *
 * Submissions are only cached after a successful fetch, and the cache is
 * always overwritten by the next successful fetch, so a stale entry never
 * wins permanently. The cache exists so that the most recent submissions can
 * be shown instantly while the fresh list loads in the background (see
 * Home.loadPreviousSubmissions).
 *
 * The cache is not keyed per user: the home-state cookie already stores the
 * user's credentials in plaintext, so anyone who can read localStorage on
 * this machine can log in as that user anyway. Logging out clears the cache,
 * which keeps one account's submissions from appearing for another account
 * that logs in later on the same machine.
 *
 * Only a bounded, newest-first prefix is cached: some users have thousands of
 * submissions, whose JSON exceeds localStorage's ~5MB per-origin quota.
 * Keeping the cache small also keeps JSON.parse fast on page load.
 */

export const STORAGE_KEY = 'reportedWebSubmissionsCache';

export const MAX_CACHED_SUBMISSIONS = 200;
export const MAX_CACHE_LENGTH = 2 * 1024 * 1024; // JSON string length

// `submissions` is newest-first (the server sorts by `timeofreport`
// descending), so keeping the head of the array keeps the most recent ones.
export const buildCachedSubmissionsJson = submissions => {
  const cached = [];
  let length = 0;
  for (const submission of submissions) {
    length += JSON.stringify(submission).length;
    // Always cache at least the newest submission, so the cache is useful
    // even if a single submission is large.
    if (length > MAX_CACHE_LENGTH && cached.length > 0) {
      break;
    }
    cached.push(submission);
    if (cached.length >= MAX_CACHED_SUBMISSIONS) {
      break;
    }
  }
  return JSON.stringify({ version: 1, submissions: cached });
};

export const readCachedSubmissions = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.submissions)) {
      return parsed.submissions;
    }
    return null;
  } catch {
    // Corrupted data or localStorage unavailable (e.g. private browsing).
    return null;
  }
};

export const writeCachedSubmissions = submissions => {
  try {
    const json = buildCachedSubmissionsJson(submissions);
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // localStorage can throw when full (QuotaExceededError) or unavailable.
  }
};

export const clearCachedSubmissions = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (e.g. private browsing).
  }
};
