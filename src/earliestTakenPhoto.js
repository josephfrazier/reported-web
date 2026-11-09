/**
 * The photo a submission takes its time from: the earliest one that says when
 * it was taken.
 *
 * That is the moment the submission describes. Three photos of a car sitting
 * in the bike lane were all taken of one violation, and it began when the
 * first of them was taken, not the last -- which is the other end from the
 * place, and why `latestLocatedPhoto` cannot answer this one.
 *
 * Nothing comes back when no photo has a capture time at all: EXIF stripped,
 * or the file is a scan. The form then keeps the time it had, rather than
 * being handed one the photos never gave.
 */

// Reads a photo reading, in the field names the grouping gives them:
// `createDateMs` for when the photo was taken, and `createDateOffset` for the
// offset that moment is read in. The offset belongs to the same photo, so the
// reading comes back whole.
export default function earliestTakenPhoto(readings) {
  const taken = readings.filter(({ createDateMs }) =>
    Number.isFinite(createDateMs),
  );

  if (taken.length === 0) {
    return null;
  }

  return taken.reduce((earliest, reading) =>
    reading.createDateMs < earliest.createDateMs ? reading : earliest,
  );
}
