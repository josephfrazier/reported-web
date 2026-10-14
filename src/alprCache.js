/**
 * A disk cache for plate reads, keyed by the exact bytes the request carries.
 *
 * The reason to have one: the same photo read twice is a call spent twice.
 * A folder run through the batch again, a photo the queue reads again, and a
 * deployment tested over and over in a day all cost calls for answers that
 * have not changed. Plate Recognizer is paid for by the call, and the plan
 * this runs on has a monthly allowance.
 *
 * The key is the SHA-256 of the uploaded bytes, before anything is done to
 * them, so a hit is answered without rotating or resizing the photo: asking
 * after that work would make a hit pay most of what the call costs, which is
 * the wait the cache exists to remove.
 *
 * The price of keying there is that the entry is the file, not the picture.
 * Two uploads that sharp would turn into the same bytes share one entry -- the
 * same pixels with different metadata or an EXIF orientation tag, say, or a
 * PNG and a lossless JPEG of it -- and are now two. A photo re-encoded by
 * another app misses either way, and a file added twice is the same bytes and
 * hits either way. The key also no longer moves when sharp does, so a sharp
 * upgrade does not empty the cache.
 *
 * The same trick names attachments in `attachmentStore.js`.
 *
 * On by default, in a directory of its own under the temp directory, because
 * the same photo read twice is a call spent twice and Heroku keeps a dyno's
 * disk for the life of that dyno. `ALPR_CACHE_DIR` moves it, and setting that
 * variable to an empty string turns the cache off -- which is what a process
 * that needs a live reading does, such as a test that checks the service
 * answers at all. Nothing expires; delete the directory to start again.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// What the cache is keyed on: the bytes the request carries, as uploaded.
export function alprCacheKey(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Where readings go when nothing says otherwise. The temp directory keeps
// them out of the checkout, and the OS clears it on its own schedule.
const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), 'reported-web-alpr-cache');

// The directory to use, or null when the cache is off. Read from the
// environment on every call rather than at import: tests set it per test, and
// the app reads it long after this module is loaded.
//
// Unset means the default directory; an empty value means no cache at all,
// since a variable that is set to nothing is how a deployment turns it off.
//
// Tests get no cache unless they name a directory: jest stubs the network, and
// the same fixture photo goes through the same code in run after run, so a
// reading stored by one run would answer the next one and hide whatever the
// test was checking. A test that is about the cache names a directory, and
// gets one.
export function alprCacheDir() {
  const configured = process.env.ALPR_CACHE_DIR;

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

// The reading stored under `key`, or null when there is none -- which is also
// the answer for a file that cannot be read or parsed. A cache that throws
// would turn a full disk into a failed plate read.
export async function readCachedReading(key) {
  const dir = alprCacheDir();

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

// Store one reading. Failures are ignored for the same reason: a full disk
// must not fail the read that was just made.
export async function writeCachedReading(key, reading) {
  const dir = alprCacheDir();

  if (!dir) {
    return;
  }

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      cacheFilePath(dir, key),
      JSON.stringify(reading),
    );
  } catch (error) {
    console.error('could not write the plate read to the cache', { error });
  }
}
