import earliestTakenPhoto from './earliestTakenPhoto.js';

// One reading, as `extractDate` answers: a moment, and the offset it is read
// in.
const takenAt = (millisecondsSinceEpoch, offset = 0) => ({
  millisecondsSinceEpoch,
  offset,
});

describe('earliestTakenPhoto', () => {
  test('takes the earliest reading, whatever order they come in', () => {
    const earliest = takenAt(1000);

    expect(earliestTakenPhoto([takenAt(3000), earliest, takenAt(2000)])).toBe(
      earliest,
    );
    expect(earliestTakenPhoto([earliest, takenAt(2000), takenAt(3000)])).toBe(
      earliest,
    );
  });

  test('brings back the offset the moment is read in', () => {
    const earliest = takenAt(1000, 240);

    expect(earliestTakenPhoto([takenAt(3000), earliest]).offset).toBe(240);
  });

  test('ignores readings with no capture time', () => {
    const earliest = takenAt(1000);

    expect(earliestTakenPhoto([takenAt(NaN), earliest, takenAt(3000)])).toBe(
      earliest,
    );
  });

  test('gives nothing back when no reading has a capture time', () => {
    // EXIF stripped, or the file is a scan: the form keeps the time it had
    // rather than being handed one the photos never gave.
    expect(earliestTakenPhoto([takenAt(NaN), takenAt(NaN)])).toBe(null);
    expect(earliestTakenPhoto([])).toBe(null);
  });

  test('leaves the readings it was given alone', () => {
    const readings = [takenAt(3000), takenAt(1000)];
    const before = readings.map(reading => ({ ...reading }));

    earliestTakenPhoto(readings);

    expect(readings).toEqual(before);
  });
});
