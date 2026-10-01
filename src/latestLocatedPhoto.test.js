import latestLocatedPhoto from './latestLocatedPhoto.js';

// `createDateMs` is the photo's capture time; `file.lastModified` is what
// stands in for a photo that has none.
const photoAt = ({ latitude, longitude, createDateMs, lastModified }) => ({
  latitude,
  longitude,
  createDateMs,
  file: { lastModified },
});

describe('latestLocatedPhoto', () => {
  test('takes the only photo that has coordinates', () => {
    const located = photoAt({
      latitude: 40.7,
      longitude: -74,
      createDateMs: 1000,
    });

    expect(
      latestLocatedPhoto([
        photoAt({ createDateMs: 500 }),
        located,
        photoAt({ createDateMs: 1500 }),
      ]),
    ).toBe(located);
  });

  test('takes the last located photo in capture order, not the first', () => {
    const early = photoAt({
      latitude: 40.7,
      longitude: -74,
      createDateMs: 1000,
    });
    const late = photoAt({
      latitude: 40.8,
      longitude: -73.9,
      createDateMs: 3000,
    });

    expect(latestLocatedPhoto([early, late])).toBe(late);
    // The order the photos arrive in says nothing; the capture time does.
    expect(latestLocatedPhoto([late, early])).toBe(late);
  });

  test('walks back past the photos with no coordinates', () => {
    const early = photoAt({
      latitude: 40.7,
      longitude: -74,
      createDateMs: 1000,
    });
    const late = photoAt({
      latitude: 40.8,
      longitude: -73.9,
      createDateMs: 3000,
    });

    expect(
      latestLocatedPhoto([
        early,
        photoAt({ createDateMs: 2000 }),
        late,
        photoAt({ createDateMs: 4000 }),
      ]),
    ).toBe(late);
  });

  test('reads coordinates that are not numbers as no coordinates', () => {
    // exifr answers with NaN rather than nothing when it cannot read a field,
    // and Android strips GPS from media shared through some apps.
    const located = photoAt({
      latitude: 40.7,
      longitude: -74,
      createDateMs: 1000,
    });

    expect(
      latestLocatedPhoto([
        located,
        photoAt({ latitude: NaN, longitude: NaN, createDateMs: 2000 }),
      ]),
    ).toBe(located);
  });

  test('takes a photo with no capture time to be the newest', () => {
    // It sorts after the photos that have one, so it is the last one that
    // knows where it was.
    const dated = photoAt({
      latitude: 40.7,
      longitude: -74,
      createDateMs: 1000,
    });
    const undated = photoAt({
      latitude: 40.8,
      longitude: -73.9,
      lastModified: 500,
    });

    expect(latestLocatedPhoto([dated, undated])).toBe(undated);
  });

  test('orders photos with no capture time by their file', () => {
    const older = photoAt({
      latitude: 40.7,
      longitude: -74,
      lastModified: 500,
    });
    const newer = photoAt({
      latitude: 40.8,
      longitude: -73.9,
      lastModified: 900,
    });

    expect(latestLocatedPhoto([older, newer])).toBe(newer);
    expect(latestLocatedPhoto([newer, older])).toBe(newer);
  });

  test('gives nothing back when no photo has coordinates', () => {
    expect(
      latestLocatedPhoto([photoAt({ createDateMs: 1000 }), photoAt({})]),
    ).toBe(null);
    expect(latestLocatedPhoto([])).toBe(null);
  });

  test('leaves the photos it was given in the order it was given them', () => {
    const photos = [
      photoAt({ latitude: 40.7, longitude: -74, createDateMs: 3000 }),
      photoAt({ latitude: 40.8, longitude: -73.9, createDateMs: 1000 }),
    ];
    const before = [...photos];

    latestLocatedPhoto(photos);

    expect(photos).toEqual(before);
  });
});
