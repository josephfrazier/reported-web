import {
  MAX_CACHED_SUBMISSIONS,
  MAX_CACHE_LENGTH,
  STORAGE_KEY,
  addCachedSubmission,
  clearCachedSubmissions,
  readCachedSubmissions,
  removeCachedSubmission,
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

// The tests below stub Storage.prototype to simulate a full or unavailable
// localStorage. Without this, those stubs would leak into every later test in
// the file (Jest doesn't restore mocks by default), silently turning their
// writes into no-ops.
afterEach(() => {
  jest.restoreAllMocks();
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

describe('addCachedSubmission', () => {
  test('caches a submission when nothing was cached yet', () => {
    addCachedSubmission({ objectId: 'new', timeofreport: 'now' });
    expect(readCachedSubmissions()).toEqual([
      { objectId: 'new', timeofreport: 'now', tasks: [] },
    ]);
  });

  test('adds the new submission at the front of the cached list', () => {
    writeCachedSubmissions(makeSubmissions(3));
    addCachedSubmission({ objectId: 'new' });
    expect(readCachedSubmissions()).toEqual([
      { objectId: 'new', tasks: [] },
      ...makeSubmissions(3),
    ]);
  });

  test('keeps the previously cached submissions', () => {
    // The caller's state can be empty (e.g. auto-loading is off), so the
    // existing cache must not be overwritten by the new submission alone.
    writeCachedSubmissions(makeSubmissions(3));
    addCachedSubmission({ objectId: 'new' });
    expect(readCachedSubmissions()).toHaveLength(4);
  });

  test('does not duplicate a submission that is already cached', () => {
    writeCachedSubmissions(makeSubmissions(3));
    addCachedSubmission({ objectId: 'submission-1', notes: 'updated' });
    expect(readCachedSubmissions()).toEqual([
      { objectId: 'submission-1', notes: 'updated', tasks: [] },
      { objectId: 'submission-0', timeofreport: 0 },
      { objectId: 'submission-2', timeofreport: 2 },
    ]);
  });

  test('keeps the newest submission when the cache is at its count cap', () => {
    writeCachedSubmissions(makeSubmissions(MAX_CACHED_SUBMISSIONS));
    addCachedSubmission({ objectId: 'new' });
    const cached = readCachedSubmissions();
    expect(cached).toHaveLength(MAX_CACHED_SUBMISSIONS);
    expect(cached[0]).toEqual({ objectId: 'new', tasks: [] });
  });

  test('keeps a tasks array the caller already provided', () => {
    addCachedSubmission({ objectId: 'new', tasks: [{ objectId: 'task-1' }] });
    expect(readCachedSubmissions()[0].tasks).toEqual([{ objectId: 'task-1' }]);
  });

  test('does not throw when localStorage is full', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => addCachedSubmission({ objectId: 'new' })).not.toThrow();
  });
});

describe('removeCachedSubmission', () => {
  test('removes the given submission from the cached list', () => {
    writeCachedSubmissions(makeSubmissions(3));
    removeCachedSubmission('submission-1');
    expect(readCachedSubmissions()).toEqual([
      makeSubmissions(3)[0],
      makeSubmissions(3)[2],
    ]);
  });

  test('leaves the cache untouched for an unknown objectId', () => {
    writeCachedSubmissions(makeSubmissions(3));
    removeCachedSubmission('not-cached');
    expect(readCachedSubmissions()).toEqual(makeSubmissions(3));
  });

  test('does nothing when nothing is cached', () => {
    removeCachedSubmission('submission-1');
    expect(readCachedSubmissions()).toBeNull();
  });
});
