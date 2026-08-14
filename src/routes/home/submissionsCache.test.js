import {
  MAX_CACHED_SUBMISSIONS,
  MAX_CACHE_LENGTH,
  STORAGE_KEY,
  clearCachedSubmissions,
  readCachedSubmissions,
  writeCachedSubmissions,
} from './submissionsCache.js';

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
    expect(readCachedSubmissions()).toBeNull();
  });

  test('round-trips submissions newest-first', () => {
    const submissions = makeSubmissions(3);
    writeCachedSubmissions(submissions);
    expect(readCachedSubmissions()).toEqual(submissions);
  });

  test('only caches the most recent submissions when there are many', () => {
    const submissions = makeSubmissions(MAX_CACHED_SUBMISSIONS * 2);
    writeCachedSubmissions(submissions);
    expect(readCachedSubmissions()).toEqual(
      submissions.slice(0, MAX_CACHED_SUBMISSIONS),
    );
  });

  test('only caches submissions that fit in the size budget', () => {
    const submissions = [
      { objectId: 'newest' },
      { objectId: 'big', notes: 'x'.repeat(MAX_CACHE_LENGTH) },
      { objectId: 'oldest' },
    ];
    writeCachedSubmissions(submissions);
    expect(readCachedSubmissions()).toEqual([{ objectId: 'newest' }]);
  });

  test('returns null for corrupted cache data', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(readCachedSubmissions()).toBeNull();
  });

  test('returns null for cache data in an unexpected shape', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, submissions: {} }),
    );
    expect(readCachedSubmissions()).toBeNull();
  });

  test('returns null for cache data from a future version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, submissions: [] }),
    );
    expect(readCachedSubmissions()).toBeNull();
  });

  test('does not throw when localStorage is full', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeCachedSubmissions(makeSubmissions(3))).not.toThrow();
  });

  test('does not throw when localStorage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCachedSubmissions()).toBeNull();
  });

  test('clears the cache', () => {
    writeCachedSubmissions(makeSubmissions(2));
    clearCachedSubmissions();
    expect(readCachedSubmissions()).toBeNull();
  });
});
