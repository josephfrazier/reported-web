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
 */

const hasCoordinates = ({ latitude, longitude }) =>
  Number.isFinite(latitude) && Number.isFinite(longitude);

const captureTimeMs = ({ createDateMs, file }) =>
  Number.isFinite(createDateMs) ? createDateMs : file?.lastModified || 0;

function compareByCaptureTime(a, b) {
  const aHasCaptureTime = Number.isFinite(a.createDateMs);
  const bHasCaptureTime = Number.isFinite(b.createDateMs);
  if (aHasCaptureTime !== bHasCaptureTime) {
    return aHasCaptureTime ? -1 : 1;
  }
  return captureTimeMs(a) - captureTimeMs(b);
}

export default function latestLocatedPhoto(photos) {
  const sorted = [...photos].sort(compareByCaptureTime);
  return sorted.filter(hasCoordinates).pop() || null;
}
