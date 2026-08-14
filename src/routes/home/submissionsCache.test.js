import {
  MAX_CACHED_SUBMISSIONS,
  MAX_CACHE_LENGTH,
  clearCachedSubmissions,
  getSubmissionsCacheKey,
  readCachedSubmissions,
  writeCachedSubmissions,
} from './submissionsCache.js';

const email = 'test@example.com';
const key = getSubmissionsCacheKey(email);

const makeSubmissions = count =>
  Array.from({ length: count }, (_, i) => ({
    objectId: `submission-${i}`,
    timeofreport: i,
  }));

beforeEach(() => {
  localStorage.clear();
});

describe('submissionsCache', () => {
  test('returns null when nothing is cached', () => {
    expect(readCachedSubmissions(email)).toBeNull();
  });

  test('round-trips submissions newest-first', () => {
    const submissions = makeSubmissions(3);
    writeCachedSubmissions(email, submissions);
    expect(readCachedSubmissions(email)).toEqual(submissions);
  });

  test('only caches the most recent submissions when there are many', () => {
    const submissions = makeSubmissions(MAX_CACHED_SUBMISSIONS * 2);
    writeCachedSubmissions(email, submissions);
    expect(readCachedSubmissions(email)).toEqual(
      submissions.slice(0, MAX_CACHED_SUBMISSIONS),
    );
  });

  test('only caches submissions that fit in the size budget', () => {
    const submissions = [
      { objectId: 'newest' },
      { objectId: 'big', notes: 'x'.repeat(MAX_CACHE_LENGTH) },
      { objectId: 'oldest' },
    ];
    writeCachedSubmissions(email, submissions);
    expect(readCachedSubmissions(email)).toEqual([{ objectId: 'newest' }]);
  });

  test('returns null for corrupted cache data', () => {
    localStorage.setItem(key, '{not valid json');
    expect(readCachedSubmissions(email)).toBeNull();
  });

  test('returns null for cache data in an unexpected shape', () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, submissions: {} }));
    expect(readCachedSubmissions(email)).toBeNull();
  });

  test('returns null for cache data from a future version', () => {
    localStorage.setItem(key, JSON.stringify({ version: 2, submissions: [] }));
    expect(readCachedSubmissions(email)).toBeNull();
  });

  test('does not throw when localStorage is full', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() =>
      writeCachedSubmissions(email, makeSubmissions(3)),
    ).not.toThrow();
  });

  test('does not throw when localStorage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCachedSubmissions(email)).toBeNull();
  });

  test('keeps different users separate', () => {
    writeCachedSubmissions(email, makeSubmissions(1));
    expect(readCachedSubmissions('other@example.com')).toBeNull();
  });

  test('ignores empty emails', () => {
    writeCachedSubmissions('', makeSubmissions(1));
    expect(readCachedSubmissions('')).toBeNull();
    clearCachedSubmissions('');
  });

  test('clears the cache', () => {
    writeCachedSubmissions(email, makeSubmissions(2));
    clearCachedSubmissions(email);
    expect(readCachedSubmissions(email)).toBeNull();
  });
});
