import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import readLicenseViaALPR from './alpr.js';
import {
  alprCacheDir,
  alprCacheKey,
  readCachedReading,
  writeCachedReading,
} from './alprCache.js';

// One reading, shaped like the object `readLicenseViaALPR` returns.
const reading = {
  results: [{ plate: 't696817c', box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }],
  uploadWidth: 1000,
  uploadHeight: 1000,
};

describe('alprCache', () => {
  let dir;

  beforeEach(async () => {
    // Per test, so the tests can run beside each other and beside whatever
    // is in the temp directory already.
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alpr-cache-test-'));
    process.env.ALPR_CACHE_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.ALPR_CACHE_DIR;
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('reads back what was written for the same bytes', async () => {
    const key = alprCacheKey(Buffer.from('one photo'));

    await writeCachedReading(key, reading);

    await expect(readCachedReading(key)).resolves.toEqual(reading);
  });

  test('keys on the bytes, not the name or the time', () => {
    const first = alprCacheKey(Buffer.from('one photo'));
    const second = alprCacheKey(Buffer.from('another photo'));

    expect(first).toBe(alprCacheKey(Buffer.from('one photo')));
    expect(first).not.toBe(second);
  });

  test('has a directory of its own outside tests', () => {
    delete process.env.ALPR_CACHE_DIR;

    // The default is where the cache lives when nothing moves it -- out of
    // the checkout, and kept for the life of the process that runs it.
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(alprCacheDir()).toBe(
        path.join(os.tmpdir(), 'reported-web-alpr-cache'),
      );
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  test('is off in a test that does not ask for it', () => {
    delete process.env.ALPR_CACHE_DIR;

    // Jest stubs the network and runs the same fixtures again and again; a
    // reading kept between runs would answer the next one.
    expect(process.env.NODE_ENV).toBe('test');
    expect(alprCacheDir()).toBeNull();
  });

  test('answers null for a reading that was never written', async () => {
    await expect(
      readCachedReading(alprCacheKey(Buffer.from('never read'))),
    ).resolves.toBeNull();
  });

  test('answers null for a file that cannot be parsed', async () => {
    const key = alprCacheKey(Buffer.from('half-written'));
    await fs.promises.writeFile(path.join(dir, `${key}.json`), '{"results":');

    // A half-written file is a miss, not an error: the read goes to Plate
    // Recognizer and the entry is written again.
    await expect(readCachedReading(key)).resolves.toBeNull();
  });

  test('is off when the directory is set to nothing', async () => {
    const key = alprCacheKey(Buffer.from('photo'));

    // Set to nothing rather than deleted: a variable a deployment sets to
    // nothing is how the cache is turned off.
    process.env.ALPR_CACHE_DIR = '';
    expect(alprCacheDir()).toBeNull();

    // Neither direction throws, and nothing is written where it would not be
    // read back from.
    await expect(writeCachedReading(key, reading)).resolves.toBeUndefined();
    await expect(readCachedReading(key)).resolves.toBeNull();
    await expect(fs.promises.readdir(dir)).resolves.toEqual([]);
  });
});

// A real image, so sharp does the work the route does.
function photoBuffer() {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer();
}

async function readPhoto(photo, { timings } = {}) {
  return readLicenseViaALPR({
    attachmentBuffer: photo,
    PLATERECOGNIZER_TOKEN_LIST: 'one,two',
    timings,
  });
}

// Runs `body` with Plate Recognizer's answer in place of the service itself: a
// test must not spend a call, and it needs the same answer every time. Puts
// back whatever fetch was there before.
async function withStubbedFetch(answer, body) {
  const hadFetch = 'fetch' in global;
  const originalFetch = global.fetch;
  const fetchSpy = jest.fn().mockResolvedValue(answer);
  global.fetch = fetchSpy;

  try {
    return await body(fetchSpy);
  } finally {
    if (hadFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  }
}

const readingAnswer = {
  ok: true,
  json: async () => ({ results: [], processing_time: 1 }),
};

describe('readLicenseViaALPR', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alpr-cache-test-'));
    process.env.ALPR_CACHE_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.ALPR_CACHE_DIR;
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('asks Plate Recognizer once for the same bytes', async () => {
    const photo = await photoBuffer();

    await withStubbedFetch(readingAnswer, async fetchSpy => {
      const first = await readPhoto(photo);
      const second = await readPhoto(photo);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });
  });

  test('answers from the entry stored under the bytes the request carries', async () => {
    // Not a photo at all: the entry is found by hashing what came in, before
    // anything looks at the image, so the reading comes back without sharp
    // having a say. That is the point of keying there -- a hit costs a hash.
    const uploaded = Buffer.from('the bytes the request carries');
    await writeCachedReading(alprCacheKey(uploaded), reading);

    await withStubbedFetch(readingAnswer, async fetchSpy => {
      await expect(readPhoto(uploaded)).resolves.toEqual(reading);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  test('reports each phase to the caller, and stores none of it', async () => {
    const photo = await photoBuffer();
    const firstTimings = {};
    const cachedTimings = {};

    await withStubbedFetch(readingAnswer, async () => {
      await readPhoto(photo, { timings: firstTimings });
      await readPhoto(photo, { timings: cachedTimings });
    });

    // The read that went to Plate Recognizer ran every phase, so the browser
    // has a number for each; the one the cache answered never called out.
    expect(firstTimings.plateRecognizer).toEqual(expect.any(Number));
    expect(firstTimings.crops).toEqual(expect.any(Number));
    expect(cachedTimings.cacheLookup).toEqual(expect.any(Number));
    expect(cachedTimings).not.toHaveProperty('plateRecognizer');

    // A stored reading is the service's answer and nothing else: timings
    // describe one request, and the next one gets its own.
    const [storedFile] = await fs.promises.readdir(dir);
    const stored = JSON.parse(
      await fs.promises.readFile(path.join(dir, storedFile), 'utf8'),
    );
    expect(stored).not.toHaveProperty('timings');
  });
});

describe('what the cache refuses to store', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alpr-cache-test-'));
    process.env.ALPR_CACHE_DIR = dir;
  });

  afterEach(async () => {
    delete process.env.ALPR_CACHE_DIR;
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('a refusal is not a reading', async () => {
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer();

    const rejection = {
      detail: 'Request was throttled. Expected available in 1 second.',
      status_code: 429,
    };
    const hadFetch = 'fetch' in global;
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => rejection,
    });
    global.fetch = fetchSpy;

    try {
      const read = () =>
        readLicenseViaALPR({
          attachmentBuffer: photo,
          PLATERECOGNIZER_TOKEN_LIST: 'one,two',
        });

      await expect(read()).rejects.toThrow('429');

      // Both tokens were refused, and nothing was written: a stored failure
      // would be served to the next attempt, which is the attempt that exists
      // to find out whether the service is answering again.
      await expect(read()).rejects.toThrow('429');
      expect(fetchSpy).toHaveBeenCalledTimes(4); // two tokens, twice
      await expect(fs.promises.readdir(dir)).resolves.toEqual([]);
    } finally {
      if (hadFetch) {
        global.fetch = originalFetch;
      } else {
        delete global.fetch;
      }
    }
  });
});
