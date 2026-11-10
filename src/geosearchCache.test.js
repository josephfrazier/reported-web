import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { geosearch } from './geoclient.js';
import {
  geosearchCacheDir,
  geosearchCacheKey,
  readCachedGeosearch,
  writeCachedGeosearch,
} from './geosearchCache.js';

// One answer, shaped like the response `geosearch` returns. The feature has no
// BBL, so the canonical choice needs no PAD lookup.
const answer = {
  data: {
    features: [
      {
        properties: {
          name: '1 MAIN STREET',
          layer: 'address',
          addendum: {},
        },
      },
    ],
  },
};

describe('geosearchCache', () => {
  let dir;
  let axiosGet;

  beforeEach(async () => {
    // Per test, so the tests can run beside each other and beside whatever is
    // in the temp directory already.
    dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'geosearch-cache-test-'),
    );
    process.env.GEOSEARCH_CACHE_DIR = dir;
    axiosGet = jest.spyOn(axios, 'get').mockResolvedValue(answer);
  });

  afterEach(async () => {
    delete process.env.GEOSEARCH_CACHE_DIR;
    axiosGet.mockRestore();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('reads back what was written for the same request', async () => {
    const key = geosearchCacheKey({ lat: 40.7, long: -73.9 });

    await writeCachedGeosearch(key, answer.data);

    await expect(readCachedGeosearch(key)).resolves.toEqual(answer.data);
  });

  test('keys on the coordinates and the selected address', () => {
    const key = geosearchCacheKey({ lat: 40.7, long: -73.9 });

    // A number and the same number as a string are one request.
    expect(geosearchCacheKey({ lat: '40.7', long: '-73.9' })).toBe(key);
    expect(geosearchCacheKey({ lat: 40.7, long: -73.9, address: '' })).toBe(
      key,
    );

    // Different coordinates, or a selected address, are different requests.
    expect(geosearchCacheKey({ lat: 40.8, long: -73.9 })).not.toBe(key);
    expect(
      geosearchCacheKey({ lat: 40.7, long: -73.9, address: '1 Main St' }),
    ).not.toBe(key);

    // Two spellings of one address that select the same feature share a key.
    expect(
      geosearchCacheKey({
        lat: 40.7,
        long: -73.9,
        address: '1 Main Street, New York, NY',
      }),
    ).toBe(geosearchCacheKey({ lat: 40.7, long: -73.9, address: '1 MAIN ST' }));
  });

  test('answers null for an answer that was never written', async () => {
    await expect(
      readCachedGeosearch(geosearchCacheKey({ lat: 40.7, long: -73.9 })),
    ).resolves.toBeNull();
  });

  test('answers null for a file that cannot be parsed', async () => {
    const key = geosearchCacheKey({ lat: 40.7, long: -73.9 });
    await fs.promises.writeFile(path.join(dir, `${key}.json`), '{"features":');

    // A half-written file is a miss, not an error: the read goes to geosearch
    // and the entry is written again.
    await expect(readCachedGeosearch(key)).resolves.toBeNull();
  });

  test('has a directory of its own outside tests', () => {
    delete process.env.GEOSEARCH_CACHE_DIR;

    // The default is where the cache lives when nothing moves it -- out of the
    // checkout, and kept for the life of the process that runs it.
    const nodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(geosearchCacheDir()).toBe(
        path.join(os.tmpdir(), 'reported-web-geosearch-cache'),
      );
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  });

  test('is off in a test that does not ask for it', () => {
    delete process.env.GEOSEARCH_CACHE_DIR;

    // The same fixtures run again and again; an answer kept between runs would
    // answer the next one and hide what it is checking.
    expect(process.env.NODE_ENV).toBe('test');
    expect(geosearchCacheDir()).toBeNull();
  });

  test('is off when the directory is set to nothing', async () => {
    const key = geosearchCacheKey({ lat: 40.7, long: -73.9 });

    // Set to nothing rather than deleted: a variable a deployment sets to
    // nothing is how the cache is turned off.
    process.env.GEOSEARCH_CACHE_DIR = '';
    expect(geosearchCacheDir()).toBeNull();

    // Neither direction throws, and nothing is written where it would not be
    // read back from.
    await expect(
      writeCachedGeosearch(key, answer.data),
    ).resolves.toBeUndefined();
    await expect(readCachedGeosearch(key)).resolves.toBeNull();
    await expect(fs.promises.readdir(dir)).resolves.toEqual([]);
  });
});

describe('geosearch', () => {
  let dir;
  let axiosGet;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'geosearch-cache-test-'),
    );
    process.env.GEOSEARCH_CACHE_DIR = dir;
    axiosGet = jest.spyOn(axios, 'get').mockResolvedValue(answer);
  });

  afterEach(async () => {
    delete process.env.GEOSEARCH_CACHE_DIR;
    axiosGet.mockRestore();
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  test('asks geosearch once for the same request', async () => {
    const first = await geosearch({ lat: 40.7, long: -73.9 });
    const second = await geosearch({ lat: 40.7, long: -73.9 });

    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // The page uses this to decide whether the address is safe to remember.
    expect(first.fellBackToTopResult).toBe(false);
  });

  test('keys the selected address after normalizing it', async () => {
    await geosearch({ lat: 40.7, long: -73.9 });
    await geosearch({
      lat: 40.7,
      long: -73.9,
      address: '1 Main Street, New York, NY',
    });
    await geosearch({ lat: 40.7, long: -73.9, address: '1 MAIN ST' });

    // The first two are different requests; the third normalizes to the second.
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  test('does not store a failed lookup', async () => {
    axiosGet.mockRejectedValueOnce(new Error('geosearch is down'));

    await expect(geosearch({ lat: 40.7, long: -73.9 })).rejects.toThrow(
      'geosearch is down',
    );

    await geosearch({ lat: 40.7, long: -73.9 });

    // The failure was not stored: the next lookup asked again.
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  test('does not store an answer that fell back because PAD was down', async () => {
    const withBbl = {
      data: {
        features: [
          {
            properties: {
              name: '1 MAIN STREET',
              layer: 'address',
              addendum: { pad: { bbl: '1000010000' } },
            },
          },
        ],
      },
    };

    axiosGet.mockImplementation(url =>
      String(url).includes('64uk-42ks')
        ? Promise.reject(new Error('PAD is down'))
        : Promise.resolve(withBbl),
    );

    const first = await geosearch({ lat: 40.7, long: -73.9 });
    await geosearch({ lat: 40.7, long: -73.9 });

    // The response says the answer fell back, so the page can leave it out of
    // its own memo too.
    expect(first.fellBackToTopResult).toBe(true);

    // The fallback was not kept: the second visit asked geosearch again, and
    // the failed PAD lookup does not hide behind an entry.
    expect(
      axiosGet.mock.calls.filter(([url]) =>
        String(url).includes('geosearch.planninglabs.nyc'),
      ),
    ).toHaveLength(2);
    await expect(fs.promises.readdir(dir)).resolves.toEqual([]);
  });
});
