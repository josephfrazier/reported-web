import groupAttachmentsByViolation, {
  mergeViolations,
  normalizedCenterDistance,
  plateCropFor,
} from './groupAttachmentsByViolation.js';

const METERS_PER_DEGREE_LATITUDE = 111320;
const BASE_LATITUDE = 40.7128;
const BASE_LONGITUDE = -74.006;

// Roughly `meters` north of the base point. Only used to place photos a long
// way apart, never to hit a boundary exactly: how many degrees a metre is
// depends on the Earth-radius constant the module uses.
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

describe('mergeViolations', () => {
  // The shape this exists for: a far shot taken to establish where the car is,
  // then closeups that read the plate three minutes later.
  const farShot = buildPhoto({
    name: 'far.jpg',
    createDateMs: 1_000_000,
    latitude: latitudeMetersNorthOf(4),
    longitude: BASE_LONGITUDE,
  });
  const closeup = plate =>
    buildPhoto({
      name: 'close.jpg',
      createDateMs: 1_180_000,
      latitude: BASE_LATITUDE,
      longitude: BASE_LONGITUDE,
      plateResults: alprResponse({
        results: [alprResult({ plate, box: CENTRED_BOX })],
      }),
    });

  test('joins two violations that the time window kept apart', () => {
    const reading = closeup('aaa111');

    // Three minutes apart, so the grouping is right to keep them separate.
    expect(groupAttachmentsByViolation([farShot, reading])).toHaveLength(2);

    const [far] = groupAttachmentsByViolation([farShot]);
    const [near] = groupAttachmentsByViolation([reading]);

    const merged = mergeViolations([near, far]);

    // One violation, oldest photo first, however the two arrive.
    expect(merged.photos.map(photo => photo.name)).toEqual([
      'far.jpg',
      'close.jpg',
    ]);
    expect(merged.plate).toBe('AAA111');
  });

  test('takes the time from the earliest photo and the place from the last', () => {
    const [far] = groupAttachmentsByViolation([farShot]);
    const [near] = groupAttachmentsByViolation([closeup('aaa111')]);

    const merged = mergeViolations([far, near]);

    // The far shot came first, so the report is of that moment...
    expect(merged.createDateMs).toBe(1_000_000);
    // ...but the closeup is the later of the two, and its fix is the one the
    // camera had settled on by then.
    expect(merged.latitude).toBe(BASE_LATITUDE);
    expect(merged.longitude).toBe(BASE_LONGITUDE);
  });

  test('keeps the plate of whichever violation read one', () => {
    // The far shot read nothing: it is the reason there are two violations and
    // only one of them can name the car.
    const [far] = groupAttachmentsByViolation([farShot]);
    const [near] = groupAttachmentsByViolation([closeup('aaa111')]);

    expect(mergeViolations([far, near]).plate).toBe('AAA111');
    expect(mergeViolations([near, far]).plate).toBe('AAA111');
  });

  test('prefers the plate with more photos behind it when both read one', () => {
    const twoPhotos = buildPhoto({
      name: 'close-2.jpg',
      createDateMs: 1_181_000,
      latitude: BASE_LATITUDE,
      longitude: BASE_LONGITUDE,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });
    const [twoReadings] = groupAttachmentsByViolation([
      closeup('aaa111'),
      twoPhotos,
    ]);
    const [oneReading] = groupAttachmentsByViolation([closeup('bbb222')]);

    const merged = mergeViolations([oneReading, twoReadings]);

    expect(merged.plate).toBe('AAA111');
    expect(merged.photos).toHaveLength(3);
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

describe('plateCropFor', () => {
  // A photo as the batch builds it, with the response's size unless the
  // caller gives the photo one of its own.
  const cropPhoto = (results, { response = {}, ...photo } = {}) => ({
    file: { name: 'frame.jpg', lastModified: 0 },
    name: 'frame.jpg',
    plateResults: alprResponse({ results, ...response }),
    ...photo,
  });

  test('finds the box of a plate another result spelled differently', () => {
    const photo = cropPhoto([
      alprResult({ plate: 'lda8765', box: CORNER_BOX }),
      // The read spelled the medallion as an OCR variant; the plate the row
      // votes for is the candidate it folds into.
      alprResult({
        plate: 't6968i7c',
        candidates: [
          { plate: 't6968i7c', score: 1 },
          { plate: 't696817c', score: 0.6 },
        ],
        box: CENTRED_BOX,
      }),
    ]);

    expect(plateCropFor({ photos: [photo], plate: 'T696817C' })).toEqual({
      photo,
      box: CENTRED_BOX,
      width: 1919,
      height: 2560,
    });
  });

  test('takes the box from the first photo that has one', () => {
    const unread = cropPhoto([]);
    const first = cropPhoto([
      alprResult({ plate: 'lda8765', box: CORNER_BOX }),
    ]);
    const second = cropPhoto([
      alprResult({ plate: 'lda8765', box: CENTRED_BOX }),
    ]);

    const crop = plateCropFor({
      photos: [unread, first, second],
      plate: 'LDA8765',
    });

    expect(crop.photo).toBe(first);
    expect(crop.box).toBe(CORNER_BOX);
  });

  test('measures the box in the photo size the read uploaded', () => {
    const photo = cropPhoto(
      [alprResult({ plate: 'lda8765', box: CORNER_BOX })],
      { uploadWidth: 2048, uploadHeight: 2048 },
    );

    const crop = plateCropFor({ photos: [photo], plate: 'LDA8765' });

    expect(crop.width).toBe(2048);
    expect(crop.height).toBe(2048);
  });

  test('answers nothing without a plate, a box, or a frame size', () => {
    const photo = cropPhoto([
      alprResult({ plate: 'lda8765', box: CORNER_BOX }),
    ]);

    expect(plateCropFor({ photos: [photo], plate: '' })).toBeNull();
    expect(plateCropFor({ photos: [photo], plate: 'AAA111' })).toBeNull();

    const withoutBox = cropPhoto([alprResult({ plate: 'lda8765' })]);
    expect(plateCropFor({ photos: [withoutBox], plate: 'LDA8765' })).toBeNull();

    const flatBox = cropPhoto([
      alprResult({
        plate: 'lda8765',
        box: { xmin: 10, ymin: 10, xmax: 10, ymax: 10 },
      }),
    ]);
    expect(plateCropFor({ photos: [flatBox], plate: 'LDA8765' })).toBeNull();

    const withoutSize = cropPhoto(
      [alprResult({ plate: 'lda8765', box: CORNER_BOX })],
      { response: { uploadWidth: undefined, uploadHeight: undefined } },
    );
    expect(
      plateCropFor({ photos: [withoutSize], plate: 'LDA8765' }),
    ).toBeNull();
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

    // The medallion's three photos are one violation, and folding is what
    // keeps them together: counted as exact strings, no two of them share a
    // plate and each reading would be a violation of its own.
    const [medallion] = violations;
    expect(medallion.photos).toEqual(photos);
    // The clean read, the only variant matching ^T\d{6}C$. Plates come back
    // uppercased, the same normalisation `extractPlate` applies to what the
    // plate input shows.
    expect(medallion.plate).toBe('T696817C');
    expect(medallion.licenseState).toBe('NY');

    // The frame read two more cars as well, and each of them is reported from
    // it. The medallion's round wins the frame and is the photo's own car, so
    // it keeps it; the other two have nothing else, and would go unreported if
    // the frame went with the round.
    expect(
      violations
        .slice(1)
        .map(violation => [
          violation.plate,
          violation.photos.map(photo => photo.name),
        ]),
    ).toEqual([
      ['K73JAU', ['variants.jpg']],
      ['LDA8765', ['variants.jpg']],
    ]);
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

  test('links photos exactly 60s apart and splits them a millisecond later', () => {
    const startTime = Date.now();
    const reading = ({ name, createDateMs, plateResults }) =>
      buildPhoto({
        name,
        createDateMs,
        latitude: BASE_LATITUDE,
        longitude: BASE_LONGITUDE,
        plateResults,
      });
    // Two photos of the same car 60 seconds apart, which the threshold links,
    // and two 60001ms apart, which it does not. Integer milliseconds make the
    // boundary exact.
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
        createDateMs: startTime + 60000,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      }),
    ];
    const split = [
      linked[0],
      reading({
        name: 'c.jpg',
        createDateMs: startTime + 60001,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      }),
    ];

    expect(groupAttachmentsByViolation(linked)).toHaveLength(1);
    expect(groupAttachmentsByViolation(split)).toHaveLength(2);
  });

  test('links photos at different places when they were shot together', () => {
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

    // Place plays no part. Two photos taken in the same moment are one
    // violation however far apart their coordinates claim to be: distances of
    // hundreds of metres inside one violation are ordinary when the photos are
    // taken from a bike, and a location fix can be wrong by more than that.
    expect(
      groupAttachmentsByViolation([reading(0), reading(800)]),
    ).toHaveLength(1);
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
    // The stripped photo is the later of the two and says nothing about where
    // it was taken, so the violation reports the latest photo that does know.
    expect(violations[0].latitude).toBe(BASE_LATITUDE);
    expect(violations[0].longitude).toBe(BASE_LONGITUDE);
  });

  test('lets the last fix in a group win, not the first', () => {
    // A camera woken up for the shot can still be reporting the fix from
    // wherever it was last used. The later reading is the one taken once the
    // GPS had caught up with the car.
    const stale = buildPhoto({
      name: 'stale.jpg',
      createDateMs: 1_000_000,
      latitude: latitudeMetersNorthOf(40),
    });
    const settled = buildPhoto({
      name: 'settled.jpg',
      createDateMs: 1_010_000,
      latitude: latitudeMetersNorthOf(1),
    });

    const [violation] = groupAttachmentsByViolation([stale, settled]);

    expect(violation.latitude).toBe(latitudeMetersNorthOf(1));
    // The time still comes from the start of the group: the report is of when
    // the violation happened, not of when its last photo was taken.
    expect(violation.createDateMs).toBe(1_000_000);
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
        stripped(startTime + 70000),
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

  test('claims a photo for the car it is of, not the one it merely mentions', () => {
    // A close-up of one car with another parked behind it: the centred box is
    // the car the photo was taken for, and the corner box is the car behind.
    const shared = buildPhoto({
      name: 'shared.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'aaa111', box: CENTRED_BOX }),
          alprResult({ plate: 'bbb222', box: CORNER_BOX }),
        ],
      }),
    });
    const behind = buildPhoto({
      name: 'behind.jpg',
      // A second later, so the two violations have an order of their own: the
      // queue walks them oldest first.
      createDateMs: 2000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'bbb222', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([shared, behind]);

    // `bbb222` is read twice to `aaa111`'s once, so it wins the vote. It must
    // not take the close-up of `aaa111` with it: a car whose only photo is
    // claimed by another car is never reported at all. Both are here, each
    // with the photo it is of.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['AAA111', ['shared.jpg']],
      ['BBB222', ['behind.jpg']],
    ]);
  });

  // Boxes across one 1000x1000 frame, from the centre outwards. A wide shot's
  // cars sit at different distances from the middle, which is what the vote
  // orders them by.
  const boxesOutwards = [
    { xmin: 490, ymin: 490, xmax: 510, ymax: 510 },
    { xmin: 300, ymin: 500, xmax: 320, ymax: 520 },
    { xmin: 680, ymin: 500, xmax: 700, ymax: 520 },
    { xmin: 60, ymin: 500, xmax: 80, ymax: 520 },
    { xmin: 920, ymin: 500, xmax: 940, ymax: 520 },
  ];

  // The bike lane: five cars parked along the block, each plate read once, in
  // the one frame. Every car's evidence is that frame, so a rule that gives it
  // to one of them and drops it for the rest reports one car out of five.
  const wideShotOfFive = () =>
    buildPhoto({
      name: 'wide.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: ['ccc333', 'bbb222', 'ddd444', 'aaa111', 'eee555'].map(
          (plate, index) => alprResult({ plate, box: boxesOutwards[index] }),
        ),
      }),
    });

  test('gives each car in one wide shot a violation of its own', () => {
    const violations = groupAttachmentsByViolation([wideShotOfFive()]);

    // All five cars, in the plate order the boxes vote them into, each
    // reported with the one photo there is of it.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['CCC333', ['wide.jpg']],
      ['BBB222', ['wide.jpg']],
      ['DDD444', ['wide.jpg']],
      ['AAA111', ['wide.jpg']],
      ['EEE555', ['wide.jpg']],
    ]);
  });

  test('shares the wide shot with the cars that have no other photo', () => {
    // One car is also photographed close up; the two beside it are not.
    const wide = wideShotOfFive();
    const closeup = buildPhoto({
      name: 'close.jpg',
      createDateMs: 2000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'ccc333', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([wide, closeup]);

    // The car with two photos has both. The cars with nothing but the wide
    // shot have that, rather than nothing.
    expect(
      Object.fromEntries(
        violations.map(violation => [
          violation.plate,
          violation.photos.map(photo => photo.name),
        ]),
      ),
    ).toEqual({
      CCC333: ['wide.jpg', 'close.jpg'],
      BBB222: ['wide.jpg'],
      DDD444: ['wide.jpg'],
      AAA111: ['wide.jpg'],
      EEE555: ['wide.jpg'],
    });
  });

  test('lists a shared photo once when its rows are merged', () => {
    const [wide] = groupAttachmentsByViolation([wideShotOfFive()]);
    const other = buildPhoto({
      name: 'other.jpg',
      createDateMs: 9000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'fff666', box: CENTRED_BOX })],
      }),
    });

    // Two violations the user put together by hand, both holding the wide
    // shot: the merged report holds it once.
    const merged = mergeViolations([
      wide,
      {
        ...wide,
        plate: 'FFF666',
        photos: [wide.photos[0], other],
      },
    ]);

    expect(merged.photos.map(photo => photo.name)).toEqual([
      'wide.jpg',
      'other.jpg',
    ]);
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
      // The third car in `1.jpg`'s frame, which has no photo of its own. Its
      // time is that photo's, so it sorts with the medallion's row.
      { plate: 'K73JAU', photos: ['1.jpg'] },
      { plate: 'LDA8765', photos: ['4.jpg', '5.jpg'] },
      { plate: '', photos: ['6.jpg'] },
    ]);

    const [medallion, passenger, later, unread] = violations;
    expect(medallion.createDateMs).toBe(startTime);
    // The passenger's only photo is the medallion's first one, so its row
    // starts at that same moment and sorts next to it.
    expect(passenger.createDateMs).toBe(startTime);
    expect(later.createDateMs).toBe(startTime + 27000);
    expect(unread.createDateMs).toBe(startTime + 158000);
    // The walk carries on down the block, so the last photo of each group is
    // the furthest along, and its fix is the one the report takes.
    expect(medallion.latitude).toBe(latitudeMetersNorthOf(5));
    expect(later.latitude).toBe(latitudeMetersNorthOf(151));
  });

  test('leaves the caller’s photo array alone', () => {
    const first = buildPhoto({ name: 'first.jpg', createDateMs: 2000 });
    const second = buildPhoto({ name: 'second.jpg', createDateMs: 1000 });
    const photos = [first, second];

    groupAttachmentsByViolation(photos);

    expect(photos).toEqual([first, second]);
  });
});
