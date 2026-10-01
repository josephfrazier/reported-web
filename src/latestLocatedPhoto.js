/**
 * The photo a submission takes its place from: the last one, in capture
 * order, that knows where it was.
 *
 * A camera that has just been woken up can give a fix from wherever it was
 * last used, so the first reading of a group is the one most likely to be
 * stale, and the last is the one taken once the GPS had caught up with the
 * car. A photo taken before the fix arrived, or with location off, has no
 * coordinates at all, so the search walks back to the latest one that has
 * them rather than forcing the user to drop a pin.
 *
 * Photos with a capture time sort first and in order. A photo without one
 * sorts after those, ordered by its file's modification time, which is all
 * that is left to order it by -- so a photo with no capture time but with
 * coordinates still wins, and it is the newest one that said where it was.
 *
 * Capture order is defined here, for everything that sorts photos by it. The
 * batch groups and clusters by the same order, and reads it from these two
 * rather than keeping its own, so that the two cannot disagree about which
 * photo is the newest.
 */

const hasCoordinates = ({ latitude, longitude }) =>
  Number.isFinite(latitude) && Number.isFinite(longitude);

// A capture time is the signal that orders photos, but plenty have none --
// EXIF stripped, or the file is a scan or a screenshot. File last-modified is
// the fallback those photos sort, cluster and report on instead.
export const effectiveTimeMs = ({ createDateMs, file }) =>
  Number.isFinite(createDateMs) ? createDateMs : file?.lastModified || 0;

// Photos with a real capture time sort first and in order; photos without one
// sort last, so a batch's unknowns never interleave with its knowns.
//
// Array.prototype.sort is stable, so photos that compare equal keep the order
// the caller passed them in.
export function compareByCaptureTime(a, b) {
  const aHasCaptureTime = Number.isFinite(a.createDateMs);
  const bHasCaptureTime = Number.isFinite(b.createDateMs);
  if (aHasCaptureTime !== bHasCaptureTime) {
    return aHasCaptureTime ? -1 : 1;
  }
  return effectiveTimeMs(a) - effectiveTimeMs(b);
}

export default function latestLocatedPhoto(photos) {
  const sorted = [...photos].sort(compareByCaptureTime);
  return sorted.filter(hasCoordinates).pop() || null;
}
