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

// Reads the shape `extractDate` answers with: `millisecondsSinceEpoch`, and
// the `offset` that moment is read in. The offset belongs to the same photo,
// so it comes back with it.
export default function earliestTakenPhoto(readings) {
  const taken = readings.filter(({ millisecondsSinceEpoch }) =>
    Number.isFinite(millisecondsSinceEpoch),
  );

  if (taken.length === 0) {
    return null;
  }

  return taken.reduce((earliest, reading) =>
    reading.millisecondsSinceEpoch < earliest.millisecondsSinceEpoch
      ? reading
      : earliest,
  );
}
