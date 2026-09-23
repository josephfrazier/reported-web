import groupAttachmentsByViolation, {
  haversineMeters,
  normalizedCenterDistance,
} from './groupAttachmentsByViolation.js';

const METERS_PER_DEGREE_LATITUDE = 111320;
const BASE_LATITUDE = 40.7128;
const BASE_LONGITUDE = -74.006;

// Roughly `meters` north of the base point. Only used to place photos well
// inside or well outside the 30m threshold, never to hit it exactly: how many
// degrees a metre is depends on the Earth-radius constant the module uses.
const latitudeMetersNorthOf = meters =>
  BASE_LATITUDE + meters / METERS_PER_DEGREE_LATITUDE;

// One record as the batch builds it. `file` is only ever consulted for
// `lastModified`, the fallback when a photo has no capture time.
const buildPhoto = ({
  name = 'photo.jpg',
  createDateMs,
  latitude = BASE_LATITUDE,
  longitude = BASE_LONGITUDE,
  plateResults,
  uploadWidth = 1919,
  uploadHeight = 2560,
  lastModified = 0,
} = {}) => ({
  file: { name, lastModified },
  name,
  createDateMs,
  latitude,
  longitude,
  plateResults,
  uploadWidth,
  uploadHeight,
});

const alprResponse = options => ({
  uploadWidth: 1919,
  uploadHeight: 2560,
  results: [],
  ...options,
});

const alprResult = ({ plate, candidates, box, region, score = 1 }) => ({
  plate,
  // Plate Recognizer always offers at least the plate it picked as a
  // candidate, ranked first.
  candidates: candidates ?? [{ plate, score }],
  box,
  region: region ?? { code: 'us-ny', score: 1 },
  score,
});

// A box in the middle of a 1000x1000 frame, and one in the top-left corner.
const CENTRED_BOX = { xmin: 490, ymin: 490, xmax: 510, ymax: 510 };
const CORNER_BOX = { xmin: 0, ymin: 0, xmax: 20, ymax: 20 };
const SQUARE = { uploadWidth: 1000, uploadHeight: 1000 };

// Copied from the checked-in Plate Recognizer snapshot
// (src/__snapshots__/alpr.test.js.snap), so folding is tested against a real
// response: one medallion read four different ways within a single photo's
// 2048-wide frame, alongside two other cars.
const alprSnapshotResults = [
  {
    box: { xmax: 1505, xmin: 1362, ymax: 1606, ymin: 1532 },
    candidates: [{ plate: 'k73jau', score: 1 }],
    plate: 'k73jau',
    region: { code: 'us-nj', score: 0.658 },
    score: 1,
  },
  {
    box: { xmax: 801, xmin: 704, ymax: 1366, ymin: 1319 },
    candidates: [
      { plate: 't696817c', score: 1 },
      { plate: 't6968i7c', score: 0.881 },
      { plate: 't696b17c', score: 0.881 },
      { plate: 't696bi7c', score: 0.762 },
    ],
    plate: 't696817c',
    region: { code: 'us-ny', score: 0.759 },
    score: 1,
  },
  {
    box: { xmax: 229, xmin: 155, ymax: 1327, ymin: 1274 },
    candidates: [{ plate: 'lda8765', score: 1 }],
    plate: 'lda8765',
    region: { code: 'us-ny', score: 0.907 },
    score: 1,
  },
];

describe('haversineMeters', () => {
  test('is zero for a point and itself', () => {
    expect(
      haversineMeters(
        { latitude: BASE_LATITUDE, longitude: BASE_LONGITUDE },
        { latitude: BASE_LATITUDE, longitude: BASE_LONGITUDE },
      ),
    ).toBe(0);
  });

  test('measures a degree of latitude as about 111km', () => {
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 0 },
      ),
    ).toBeCloseTo(111195, -2);
  });

  test('measures a degree of longitude at the equator as about 111km too', () => {
    expect(
      haversineMeters(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
    ).toBeCloseTo(111195, -2);
  });
});

describe('normalizedCenterDistance', () => {
  test('is zero for a box at the centre of the frame', () => {
    expect(normalizedCenterDistance(CENTRED_BOX, 1000, 1000)).toBe(0);
  });

  test('is the distance from the centre as a fraction of the frame diagonal', () => {
    // The corner box's centre is 490px left of and 490px above the frame
    // centre, i.e. hypot(490, 490) = 692.96px, over a 1414.21px diagonal.
    expect(normalizedCenterDistance(CORNER_BOX, 1000, 1000)).toBeCloseTo(
      0.49,
      2,
    );
  });

  test('compares a large frame with a small one', () => {
    // The same box at twice the resolution is the same distance from the
    // centre, which is what makes a 4096-wide and a 2048-wide photo
    // comparable.
    const small = normalizedCenterDistance(CORNER_BOX, 1000, 1000);
    const large = normalizedCenterDistance(
      { xmin: 0, ymin: 0, xmax: 40, ymax: 40 },
      2000,
      2000,
    );
    expect(large).toBeCloseTo(small, 10);
  });

  test('is null when the box or the frame size is missing', () => {
    expect(normalizedCenterDistance(undefined, 1000, 1000)).toBeNull();
    expect(normalizedCenterDistance(CORNER_BOX, undefined, 1000)).toBeNull();
    expect(normalizedCenterDistance(CORNER_BOX, 1000, undefined)).toBeNull();
  });
});

describe('groupAttachmentsByViolation', () => {
  test('returns nothing for no photos', () => {
    expect(groupAttachmentsByViolation([])).toEqual([]);
  });

  test('folds the OCR variants of one medallion into a single violation', () => {
    const startTime = Date.now();
    // One photo reading the medallion four ways, plus its partial re-reads
    // either side of it. Folding is what keeps these three together: counted
    // as exact strings there is no plate that two of them share, so the vote
    // would have nothing to pick and each reading would become a violation of
    // its own.
    const medallionReading = plate =>
      buildPhoto({
        name: `${plate}.jpg`,
        createDateMs: startTime,
        plateResults: alprResponse({
          results: [
            alprResult({
              plate,
              box: { xmin: 704, ymin: 1319, xmax: 801, ymax: 1366 },
            }),
          ],
        }),
      });
    const photos = [
      buildPhoto({
        name: 'variants.jpg',
        createDateMs: startTime,
        plateResults: alprResponse({ results: alprSnapshotResults }),
        uploadWidth: 1919,
        uploadHeight: 2560,
      }),
      medallionReading('t6968i7c'),
      medallionReading('t696817c'),
    ];

    const violations = groupAttachmentsByViolation(photos);

    expect(violations).toHaveLength(1);
    expect(violations[0].photos).toEqual(photos);
    // The clean read, the only variant matching ^T\d{6}C$. Plates come back
    // uppercased, the same normalisation `extractPlate` applies to what the
    // plate input shows.
    expect(violations[0].plate).toBe('T696817C');
    expect(violations[0].licenseState).toBe('NY');
  });

  test('splits two cars photographed back-to-back into two violations', () => {
    const startTime = Date.now();
    const reading = ({ name, plate, createDateMs }) =>
      buildPhoto({
        name,
        createDateMs,
        plateResults: alprResponse({
          results: [alprResult({ plate, box: CENTRED_BOX })],
        }),
      });
    const first = reading({
      name: 'first.jpg',
      plate: 'aaa111',
      createDateMs: startTime,
    });
    const second = reading({
      name: 'second.jpg',
      plate: 'bbb222',
      createDateMs: startTime + 4000,
    });

    const violations = groupAttachmentsByViolation([first, second]);

    // Same time and place, so only the plates separate them.
    expect(violations.map(violation => violation.plate)).toEqual([
      'AAA111',
      'BBB222',
    ]);
    expect(violations.map(violation => violation.photos)).toEqual([
      [first],
      [second],
    ]);
  });

  test('links photos exactly 5000ms apart and splits them a millisecond later', () => {
    const startTime = Date.now();
    const reading = ({ name, createDateMs, plateResults }) =>
      buildPhoto({
        name,
        createDateMs,
        latitude: BASE_LATITUDE,
        longitude: BASE_LONGITUDE,
        plateResults,
      });
    // Two photos of the same car 5 seconds apart, which the plan's threshold
    // links, and two 5001ms apart, which it does not. Integer milliseconds
    // make the boundary exact, unlike the metres below.
    const linked = [
      reading({
        name: 'a.jpg',
        createDateMs: startTime,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      }),
      reading({
        name: 'b.jpg',
        createDateMs: startTime + 5000,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      }),
    ];
    const split = [
      linked[0],
      reading({
        name: 'c.jpg',
        createDateMs: startTime + 5001,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      }),
    ];

    expect(groupAttachmentsByViolation(linked)).toHaveLength(1);
    expect(groupAttachmentsByViolation(split)).toHaveLength(2);
  });

  test('splits photos more than 30m apart, however close together they were shot', () => {
    const startTime = Date.now();
    const reading = meters =>
      buildPhoto({
        name: `${meters}m.jpg`,
        createDateMs: startTime,
        latitude: latitudeMetersNorthOf(meters),
        longitude: BASE_LONGITUDE,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      });

    const withinThreshold = [reading(0), reading(29)];
    const beyondThreshold = [reading(0), reading(31)];

    expect(groupAttachmentsByViolation(withinThreshold)).toHaveLength(1);
    expect(groupAttachmentsByViolation(beyondThreshold)).toHaveLength(2);
  });

  test('links a photo with no GPS on capture time alone', () => {
    const startTime = Date.now();
    const located = buildPhoto({
      name: 'located.jpg',
      createDateMs: startTime,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });
    // Android strips GPS from media shared through some apps, so a photo
    // without coordinates must still join the batch it was shot with.
    const stripped = buildPhoto({
      name: 'stripped.jpg',
      createDateMs: startTime + 4000,
      latitude: undefined,
      longitude: undefined,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([located, stripped]);

    expect(violations).toHaveLength(1);
    expect(violations[0].photos).toEqual([located, stripped]);
    // Nothing is known about where the earliest photo was taken, so the
    // violation reports the earliest photo that does know.
    expect(violations[0].latitude).toBe(BASE_LATITUDE);
    expect(violations[0].longitude).toBe(BASE_LONGITUDE);
  });

  test('still splits photos with no GPS that are too far apart in time', () => {
    const startTime = Date.now();
    const stripped = createDateMs =>
      buildPhoto({
        name: `stripped-${createDateMs}.jpg`,
        createDateMs,
        latitude: undefined,
        longitude: undefined,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      });

    expect(
      groupAttachmentsByViolation([
        stripped(startTime),
        stripped(startTime + 20000),
      ]),
    ).toHaveLength(2);
  });

  test('falls back to file last-modified when a photo has no capture time', () => {
    const samePlate = alprResponse({
      results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
    });
    const first = buildPhoto({
      name: 'first.jpg',
      createDateMs: 1000,
      plateResults: samePlate,
    });
    const reading = buildPhoto({
      name: 'reading.jpg',
      createDateMs: 5000,
      plateResults: samePlate,
    });
    // No capture time at all, so it sorts last even though its last-modified
    // is earlier than `reading`'s capture time.
    const noTime = buildPhoto({
      name: 'no-time.jpg',
      createDateMs: undefined,
      lastModified: 3000,
      plateResults: samePlate,
    });

    const violations = groupAttachmentsByViolation([first, reading, noTime]);

    expect(violations).toHaveLength(1);
    expect(violations[0].photos).toEqual([first, reading, noTime]);
    expect(violations[0].createDateMs).toBe(1000);
  });

  test('reports the file last-modified of a photo that has no capture time', () => {
    const noTime = buildPhoto({
      name: 'no-time.jpg',
      createDateMs: undefined,
      lastModified: 3000,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([noTime]);

    expect(violations[0].createDateMs).toBe(3000);
  });

  test('keeps a cluster with no plate read at all, flagged for manual entry', () => {
    const startTime = Date.now();
    const blurry = [
      buildPhoto({
        name: 'blurry-1.jpg',
        createDateMs: startTime,
        plateResults: alprResponse({ results: [] }),
      }),
      buildPhoto({
        name: 'blurry-2.jpg',
        createDateMs: startTime + 2000,
        plateResults: alprResponse({ results: [] }),
      }),
    ];

    const violations = groupAttachmentsByViolation(blurry);

    expect(violations).toHaveLength(1);
    expect(violations[0].plate).toBe('');
    expect(violations[0].photos).toEqual(blurry);
  });

  test('adopts a photo with no plate read into the sub-cluster nearest in capture time', () => {
    const startTime = Date.now();
    const reading = ({ name, plate, createDateMs }) =>
      buildPhoto({
        name,
        createDateMs,
        plateResults: alprResponse({
          results: [alprResult({ plate, box: CENTRED_BOX })],
        }),
      });
    // Three photos of one car, with a blurry shot between the last two: the
    // blurry one is nearer in time to the second reading than to the first.
    const first = reading({
      name: 'first.jpg',
      plate: 'aaa111',
      createDateMs: startTime,
    });
    const blurry = buildPhoto({
      name: 'blurry.jpg',
      createDateMs: startTime + 11000,
      plateResults: alprResponse({ results: [] }),
    });
    const second = reading({
      name: 'second.jpg',
      plate: 'bbb222',
      createDateMs: startTime + 14000,
    });

    const violations = groupAttachmentsByViolation([first, blurry, second]);

    expect(violations.map(violation => violation.plate)).toEqual([
      'AAA111',
      'BBB222',
    ]);
    expect(violations[0].photos).toEqual([first]);
    expect(violations[1].photos).toEqual([blurry, second]);
  });

  test('picks the most central reading when the photo counts tie', () => {
    const photo = buildPhoto({
      name: 'two-boxes.jpg',
      createDateMs: 1000,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          // A box in the corner read only the plain plate.
          alprResult({
            plate: 'aaa111',
            candidates: [{ plate: 'aaa111', score: 1 }],
            box: CORNER_BOX,
          }),
          // A box at the centre read it alongside a variant.
          alprResult({
            plate: 'aaa111',
            candidates: [
              { plate: 'aaa111', score: 1 },
              { plate: 'aaa222', score: 0.5 },
            ],
            box: CENTRED_BOX,
          }),
        ],
      }),
    });

    const violations = groupAttachmentsByViolation([photo]);

    expect(violations).toHaveLength(1);
    // Both readings cover one photo each, so the tie-break is how central
    // their boxes are -- and `AAA222`'s only box is the centred one. Score
    // would have picked `AAA111` instead, which is the point: the tie-breaks
    // are ordered.
    expect(violations[0].plate).toBe('AAA222');
  });

  test('picks the highest score when everything else ties', () => {
    const photo = buildPhoto({
      name: 'two-readings.jpg',
      createDateMs: 1000,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({
            plate: 'aaa111',
            candidates: [
              { plate: 'aaa111', score: 0.9 },
              { plate: 'bbb222', score: 0.2 },
            ],
            box: CORNER_BOX,
          }),
          // The same two readings again, from a different box, so both
          // candidates come out equally central and equally photographed.
          alprResult({
            plate: 'aaa111',
            candidates: [
              { plate: 'aaa111', score: 0.9 },
              { plate: 'bbb222', score: 0.2 },
            ],
            box: CENTRED_BOX,
          }),
        ],
      }),
    });

    const violations = groupAttachmentsByViolation([photo]);

    expect(violations).toHaveLength(1);
    expect(violations[0].plate).toBe('AAA111');
  });

  test('groups the six photos of the plan’s worked example', () => {
    // One walk down a block: photos 1-3 are the same medallion read three
    // ways, 4-5 are a second car, 6 is a shot where ALPR failed.
    const startTime = new Date('2026-09-23T08:14:02Z').getTime();
    const at = (seconds, meters) => ({
      createDateMs: startTime + seconds * 1000,
      latitude: latitudeMetersNorthOf(meters),
      longitude: BASE_LONGITUDE,
    });
    const medallionBox = { xmin: 704, ymin: 1319, xmax: 801, ymax: 1366 };
    const medallionReading = plate =>
      alprResponse({
        results: [alprResult({ plate, box: medallionBox })],
      });

    const photos = [
      buildPhoto({
        name: '1.jpg',
        ...at(0, 0),
        plateResults: alprResponse({ results: alprSnapshotResults }),
      }),
      buildPhoto({
        name: '2.jpg',
        ...at(4, 3),
        plateResults: medallionReading('t6968i7c'),
      }),
      buildPhoto({
        name: '3.jpg',
        ...at(9, 5),
        plateResults: medallionReading('t696817c'),
      }),
      buildPhoto({
        name: '4.jpg',
        ...at(27, 149),
        plateResults: alprResponse({
          results: [alprResult({ plate: 'lda8765', box: CENTRED_BOX })],
        }),
      }),
      buildPhoto({
        name: '5.jpg',
        ...at(31, 151),
        plateResults: alprResponse({
          results: [alprResult({ plate: 'lda8765', box: CENTRED_BOX })],
        }),
      }),
      buildPhoto({
        name: '6.jpg',
        ...at(158, 305),
        plateResults: alprResponse({ results: [] }),
      }),
    ];

    const violations = groupAttachmentsByViolation(photos);

    expect(
      violations.map(violation => ({
        plate: violation.plate,
        photos: violation.photos.map(photo => photo.name),
      })),
    ).toEqual([
      { plate: 'T696817C', photos: ['1.jpg', '2.jpg', '3.jpg'] },
      { plate: 'LDA8765', photos: ['4.jpg', '5.jpg'] },
      { plate: '', photos: ['6.jpg'] },
    ]);

    const [first, second, third] = violations;
    expect(first.createDateMs).toBe(startTime);
    expect(second.createDateMs).toBe(startTime + 27000);
    expect(third.createDateMs).toBe(startTime + 158000);
    expect(first.latitude).toBe(BASE_LATITUDE);
    expect(second.latitude).toBe(latitudeMetersNorthOf(149));
  });

  test('leaves the caller’s photo array alone', () => {
    const first = buildPhoto({ name: 'first.jpg', createDateMs: 2000 });
    const second = buildPhoto({ name: 'second.jpg', createDateMs: 1000 });
    const photos = [first, second];

    groupAttachmentsByViolation(photos);

    expect(photos).toEqual([first, second]);
  });
});
