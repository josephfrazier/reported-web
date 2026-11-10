/**
 * A disk cache for geosearch answers, keyed by the request that asks for them.
 *
 * The reason to have one: the page memoises a place for the length of a visit,
 * but a reload, a new visit and a second report from the same curb ask again.
 * Geosearch is a public service shared with the rest of the city, and a batch
 * of photos at one kerb is dozens of identical lookups; the page's memo
 * collapses those, and this keeps the next visit from asking again.
 *
 * The key is the coordinates and the address the user selected, when there was
 * one. `selectCanonicalFeature` compares that address after
 * `normalizeAddress`, so two spellings that would select the same feature
 * share an entry.
 *
 * The answer stored is the whole response, including the canonical feature
 * chosen for those inputs. An answer that fell back to the top result because
 * the city's address directory was unavailable is stored like any other.
 * Nothing expires: addresses rarely change, and a correction comes in with a
 * cleared directory. `GEOSEARCH_CACHE_DIR` moves the directory, and an empty
 * value turns the cache off, as it does for ALPR. A failed lookup is not
 * stored, and a cache that cannot be read or written is a miss, never an
 * error.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import normalizeAddress from './normalizeAddress.js';

// What the cache is keyed on: the coordinates, and the address the user
// selected when there was one, normalized the way the canonical feature
// compares it.
export function geosearchCacheKey({ lat, long, address }) {
  const normalized = [
    Number(lat),
    Number(long),
    address ? normalizeAddress(String(address)) : '',
  ].join('\n');

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Where answers go when nothing says otherwise. The temp directory keeps them
// out of the checkout, and the OS clears it on its own schedule.
const DEFAULT_CACHE_DIR = path.join(
  os.tmpdir(),
  'reported-web-geosearch-cache',
);

// The directory to use, or null when the cache is off. Read from the
// environment on every call rather than at import: tests set it per test, and
// the app reads it long after this module is loaded.
//
// Unset means the default directory; an empty value means no cache at all.
// Tests get no cache unless they name a directory: the same fixtures run again
// and again, and a stored answer would hide what the next test is checking.
export function geosearchCacheDir() {
  const configured = process.env.GEOSEARCH_CACHE_DIR;

  if (configured !== undefined) {
    return configured || null;
  }

  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  return DEFAULT_CACHE_DIR;
}

function cacheFilePath(dir, key) {
  return path.join(dir, `${key}.json`);
}

// The answer stored under `key`, or null when there is none -- which is also
// the answer for a file that cannot be read or parsed. A cache that throws
// would turn a full disk into a failed geosearch.
export async function readCachedGeosearch(key) {
  const dir = geosearchCacheDir();

  if (!dir) {
    return null;
  }

  try {
    const contents = await fs.promises.readFile(
      cacheFilePath(dir, key),
      'utf8',
    );
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

// Store one answer. Failures are ignored for the same reason: a full disk must
// not fail the lookup that was just made.
export async function writeCachedGeosearch(key, answer) {
  const dir = geosearchCacheDir();

  if (!dir) {
    return;
  }

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      cacheFilePath(dir, key),
      JSON.stringify(answer),
    );
  } catch (error) {
    console.error('could not write the geosearch answer to the cache', {
      error,
    });
  }
}
