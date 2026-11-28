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
  // then closeups that read the plate three minutes later. The far shot reads
  // no plate, so the grouping has nothing to join it with.
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

  test('joins a photo with no read to the closeup that names the car', () => {
    const reading = closeup('aaa111');

    // The far shot has no plate to match, so the grouping keeps the two apart.
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

  test('keeps the earliest record when neither violation has photos', () => {
    const first = {
      photos: [],
      plate: 'AAA111',
      licenseState: 'NY',
      createDateMs: 1_000_000,
      latitude: 40.7,
      longitude: -73.9,
    };
    const second = {
      photos: [],
      plate: '',
      licenseState: '',
      createDateMs: 2_000_000,
      latitude: 40.8,
      longitude: -73.8,
    };

    const merged = mergeViolations([second, first]);

    expect(merged.photos).toEqual([]);
    expect(merged.plate).toBe('AAA111');
    expect(merged.createDateMs).toBe(1_000_000);
    expect(merged.latitude).toBe(40.7);
    expect(merged.longitude).toBe(-73.9);
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

  test('takes a later reading when the first has no box', () => {
    const photo = cropPhoto([
      alprResult({ plate: 'lda8765' }),
      alprResult({ plate: 'lda8765', box: CENTRED_BOX }),
    ]);

    expect(plateCropFor({ photos: [photo], plate: 'LDA8765' })).toEqual({
      photo,
      box: CENTRED_BOX,
      width: 1919,
      height: 2560,
    });
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

  test('makes each photo a violation of its own when no plate joins them', () => {
    // Cars parked along one block are seconds and metres apart. That is not
    // evidence that they are one car, so time and place are not grouping
    // signals: without a plate read, each photo stands alone.
    const photos = [
      buildPhoto({ name: 'first.jpg', createDateMs: 1000 }),
      buildPhoto({ name: 'second.jpg', createDateMs: 2000 }),
      buildPhoto({ name: 'third.jpg', createDateMs: 3000 }),
    ];

    const violations = groupAttachmentsByViolation(photos);

    expect(violations.map(violation => violation.photos)).toEqual([
      [photos[0]],
      [photos[1]],
      [photos[2]],
    ]);
    expect(violations.map(violation => violation.plate)).toEqual(['', '', '']);
  });

  test('leaves a photo with no plate read as a violation of its own', () => {
    const startTime = Date.now();
    const reading = name =>
      buildPhoto({
        name,
        createDateMs: startTime,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      });
    const first = reading('first.jpg');
    const blurry = buildPhoto({
      name: 'blurry.jpg',
      createDateMs: startTime + 500,
      plateResults: alprResponse({ results: [] }),
    });
    const second = reading('second.jpg');

    const violations = groupAttachmentsByViolation([first, blurry, second]);

    // The two readings of one plate are one violation, and the blurry shot
    // between them is not adopted by it: nothing says which car it is of, and
    // time cannot be trusted to say. The user can merge it by hand.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['AAA111', ['first.jpg', 'second.jpg']],
      ['', ['blurry.jpg']],
    ]);
  });

  test('merges photos that read the same plate far apart in time', () => {
    const reading = (name, createDateMs) =>
      buildPhoto({
        name,
        createDateMs,
        plateResults: alprResponse({
          results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
        }),
      });

    // Three minutes apart: an establishing shot and a closeup of one car.
    // The plate is what says they are one violation.
    const violations = groupAttachmentsByViolation([
      reading('far.jpg', 1_000_000),
      reading('close.jpg', 1_180_000),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0].photos.map(photo => photo.name)).toEqual([
      'far.jpg',
      'close.jpg',
    ]);
    expect(violations[0].createDateMs).toBe(1_000_000);
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

    // Same time and place, and different plates.
    expect(violations.map(violation => violation.plate)).toEqual([
      'AAA111',
      'BBB222',
    ]);
    expect(violations.map(violation => violation.photos)).toEqual([
      [first],
      [second],
    ]);
  });

  test('merges photos at different places when they read the same plate', () => {
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

    // Place plays no part. Photos of one car taken from a bike can be hundreds
    // of metres apart, and a fix can be wrong by more than that.
    expect(
      groupAttachmentsByViolation([reading(0), reading(800)]),
    ).toHaveLength(1);
  });

  test('merges a photo with no GPS when the plate agrees', () => {
    const startTime = Date.now();
    const located = buildPhoto({
      name: 'located.jpg',
      createDateMs: startTime,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });
    // Android strips GPS from media shared through some apps, so a photo
    // without coordinates must still join its car.
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
    const reading = plate => ({
      results: [alprResult({ plate, box: CENTRED_BOX })],
    });
    const stale = buildPhoto({
      name: 'stale.jpg',
      createDateMs: 1_000_000,
      latitude: latitudeMetersNorthOf(40),
      plateResults: alprResponse(reading('aaa111')),
    });
    const settled = buildPhoto({
      name: 'settled.jpg',
      createDateMs: 1_010_000,
      latitude: latitudeMetersNorthOf(1),
      plateResults: alprResponse(reading('aaa111')),
    });

    const [violation] = groupAttachmentsByViolation([stale, settled]);

    expect(violation.latitude).toBe(latitudeMetersNorthOf(1));
    // The time still comes from the start of the group: the report is of when
    // the violation happened, not of when its last photo was taken.
    expect(violation.createDateMs).toBe(1_000_000);
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

  test('folds the OCR variants of one medallion into a single violation', () => {
    const startTime = Date.now();
    // One photo reading the medallion four ways, plus its partial re-reads
    // either side of it. Folding is what keeps these three together: counted
    // as exact strings there is no plate that two of them share, so the vote
    // would have nothing to pick and each reading would become a violation of
    // its own.
    const medallionBox = { xmin: 704, ymin: 1319, xmax: 801, ymax: 1366 };
    const medallionReading = plate =>
      buildPhoto({
        name: `${plate}.jpg`,
        createDateMs: startTime,
        plateResults: alprResponse({
          results: [alprResult({ plate, box: medallionBox })],
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
    expect(violations).toHaveLength(1);
    expect(violations[0].photos).toEqual(photos);
    // The clean read, the only variant matching ^T\d{6}C$. Plates come back
    // uppercased, the same normalisation `extractPlate` applies to what the
    // plate input shows.
    expect(violations[0].plate).toBe('T696817C');
    expect(violations[0].licenseState).toBe('NY');
  });

  test('merges two photos whose candidate sets name the same plate', () => {
    const medallionBox = { xmin: 704, ymin: 1319, xmax: 801, ymax: 1366 };
    const first = buildPhoto({
      name: 'first.jpg',
      createDateMs: 1000,
      plateResults: alprResponse({
        results: [
          alprResult({
            plate: 't6968i7c',
            candidates: [
              { plate: 't6968i7c', score: 1 },
              { plate: 't696817c', score: 0.6 },
            ],
            box: medallionBox,
          }),
        ],
      }),
    });
    const second = buildPhoto({
      name: 'second.jpg',
      createDateMs: 2000,
      plateResults: alprResponse({
        results: [alprResult({ plate: 't696817c', box: medallionBox })],
      }),
    });

    const [violation] = groupAttachmentsByViolation([first, second]);

    // The readings differ, but the first offers the second as its own
    // alternative, so they are one plate.
    expect(violation.photos).toEqual([first, second]);
    expect(violation.plate).toBe('T696817C');
  });

  test('takes the first result as the photo’s plate, not the most central one', () => {
    const photo = buildPhoto({
      name: 'two-cars.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          // The read named this plate first. A box nearer the middle of the
          // frame read the other car, and that does not make it the subject.
          alprResult({ plate: 'aaa111', box: CORNER_BOX }),
          alprResult({ plate: 'bbb222', box: CENTRED_BOX }),
        ],
      }),
    });

    const [violation] = groupAttachmentsByViolation([photo]);

    expect(violation.plate).toBe('AAA111');
  });

  test('merges on the first result rather than the most central plate', () => {
    const first = buildPhoto({
      name: 'first.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'aaa111', box: CORNER_BOX }),
          alprResult({ plate: 'bbb222', box: CENTRED_BOX }),
        ],
      }),
    });
    const second = buildPhoto({
      name: 'second.jpg',
      createDateMs: 2000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([first, second]);

    expect(violations).toHaveLength(1);
    expect(violations[0].plate).toBe('AAA111');
    expect(violations[0].photos).toEqual([first, second]);
  });

  test('prefers a medallion result over the first result', () => {
    const photo = buildPhoto({
      name: 'medallion.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'aaa111', box: CENTRED_BOX }),
          alprResult({ plate: 't696817c', box: CORNER_BOX }),
        ],
      }),
    });

    const [violation] = groupAttachmentsByViolation([photo]);

    expect(violation.plate).toBe('T696817C');
  });

  test('prefers a padded medallion result over the first result', () => {
    const photo = buildPhoto({
      name: 'padded-medallion.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'aaa111', box: CENTRED_BOX }),
          alprResult({ plate: ' t696817c ', box: CORNER_BOX }),
        ],
      }),
    });

    const [violation] = groupAttachmentsByViolation([photo]);

    expect(violation.plate).toBe('T696817C');
  });

  test('prefers a medallion result with whitespace inside the plate', () => {
    const photo = buildPhoto({
      name: 'spaced-medallion.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'aaa111', box: CENTRED_BOX }),
          alprResult({ plate: ' t 6 9 6 8 1 7 c ', box: CORNER_BOX }),
        ],
      }),
    });

    const [violation] = groupAttachmentsByViolation([photo]);

    expect(violation.plate).toBe('T696817C');
  });

  test('takes the license state from a later reading of the plate', () => {
    const photo = buildPhoto({
      name: 'state.jpg',
      createDateMs: 1000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          // The first reading of the plate has no parseable region; the
          // second one does.
          alprResult({ plate: 'aaa111', region: {}, box: CORNER_BOX }),
          alprResult({
            plate: 'aaa111',
            region: { code: 'us-nj', score: 1 },
            box: CENTRED_BOX,
          }),
        ],
      }),
    });

    const [violation] = groupAttachmentsByViolation([photo]);

    expect(violation.licenseState).toBe('NJ');
  });

  // Boxes across one 1000x1000 frame, from the centre outwards. A wide shot's
  // cars sit at different distances from the middle, which is what tells the
  // car the photo is of from the cars behind it.
  const boxesOutwards = [
    { xmin: 490, ymin: 490, xmax: 510, ymax: 510 },
    { xmin: 300, ymin: 500, xmax: 320, ymax: 520 },
    { xmin: 680, ymin: 500, xmax: 700, ymax: 520 },
    { xmin: 60, ymin: 500, xmax: 80, ymax: 520 },
    { xmin: 920, ymin: 500, xmax: 940, ymax: 520 },
  ];

  const wideShot = () =>
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

  test('gives a wide shot one violation, for the car it is of', () => {
    const violations = groupAttachmentsByViolation([wideShot()]);

    // The photo is one violation: it is a photo of `ccc333`, the plate nearest
    // the centre of the frame. The other cars in the frame do not each get a
    // row, because one photo cannot be evidence for four cars at once.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([['CCC333', ['wide.jpg']]]);
  });

  test('merges a wide shot with a closeup of the car it is of', () => {
    const wide = wideShot();
    const closeup = buildPhoto({
      name: 'subject.jpg',
      createDateMs: 2000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'ccc333', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([wide, closeup]);

    // The closeup names the car the wide shot is of, so the two are one
    // violation. The other cars in the frame have no photo of their own.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([['CCC333', ['wide.jpg', 'subject.jpg']]]);
  });

  test('does not merge a wide shot with the closeup of another car in it', () => {
    const wide = wideShot();
    const closeup = buildPhoto({
      name: 'other.jpg',
      createDateMs: 2000,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });

    const violations = groupAttachmentsByViolation([wide, closeup]);

    // The wide shot is a photo of `ccc333`, the car nearest its centre. Its
    // `aaa111` read is a car behind, and joining the closeup of that car
    // would leave `ccc333` with no photo of its own.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['CCC333', ['wide.jpg']],
      ['AAA111', ['other.jpg']],
    ]);
  });

  test('leaves a wide shot on its own when two cars in it have closeups', () => {
    const wide = wideShot();
    const closeupOf = (name, plate, createDateMs) =>
      buildPhoto({
        name,
        createDateMs,
        ...SQUARE,
        plateResults: alprResponse({
          ...SQUARE,
          results: [alprResult({ plate, box: CENTRED_BOX })],
        }),
      });
    const subject = closeupOf('subject.jpg', 'ccc333', 2000);
    const other = closeupOf('other.jpg', 'aaa111', 3000);

    const violations = groupAttachmentsByViolation([wide, subject, other]);

    // The frame reads two plates that other photos also read, so it is
    // evidence for two cars. Giving it to either row would take it from the
    // other, so it stays a violation of its own. The closeups merge with
    // nothing, each being the only photo of its own car's plate.
    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['CCC333', ['wide.jpg']],
      ['CCC333', ['subject.jpg']],
      ['AAA111', ['other.jpg']],
    ]);
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

    // The plate in the corner is the car behind, not the car the photo is of.
    // It is read twice to `aaa111`'s once, and it must not take the close-up
    // with it: a car whose only photo is claimed by another car is never
    // reported at all. Both are here, each with the photo it is of.
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

  test('leaves a photo that reads two shared plates on its own', () => {
    // One frame shows two cars, and each car has closeups of its own. The
    // frame is evidence for both, so it cannot join either row: joining one
    // would take the frame from the other.
    const startTime = Date.now();
    const reading = ({ name, plate, createDateMs, box = CENTRED_BOX }) =>
      buildPhoto({
        name,
        createDateMs,
        ...SQUARE,
        plateResults: alprResponse({
          ...SQUARE,
          results: [alprResult({ plate, box })],
        }),
      });
    const both = buildPhoto({
      name: 'both.jpg',
      createDateMs: startTime,
      ...SQUARE,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({ plate: 'ppp111', box: CENTRED_BOX }),
          alprResult({ plate: 'qqq222', box: CORNER_BOX }),
        ],
      }),
    });
    const firstCarOne = reading({
      name: 'p1.jpg',
      plate: 'ppp111',
      createDateMs: startTime + 1000,
    });
    const firstCarTwo = reading({
      name: 'p2.jpg',
      plate: 'ppp111',
      createDateMs: startTime + 2000,
    });
    const secondCarOne = reading({
      name: 'q1.jpg',
      plate: 'qqq222',
      createDateMs: startTime + 3000,
    });
    const secondCarTwo = reading({
      name: 'q2.jpg',
      plate: 'qqq222',
      createDateMs: startTime + 4000,
    });

    const violations = groupAttachmentsByViolation([
      both,
      firstCarOne,
      firstCarTwo,
      secondCarOne,
      secondCarTwo,
    ]);

    expect(
      violations.map(violation => [
        violation.plate,
        violation.photos.map(photo => photo.name),
      ]),
    ).toEqual([
      ['PPP111', ['both.jpg']],
      ['PPP111', ['p1.jpg', 'p2.jpg']],
      ['QQQ222', ['q1.jpg', 'q2.jpg']],
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

  test('normalizes padded plate strings before the score tie-break', () => {
    const photo = buildPhoto({
      name: 'padded.jpg',
      createDateMs: 1000,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({
            plate: ' zzz999 ',
            score: 0.1,
            candidates: [
              { plate: 'zzz999 ', score: 0.9 },
              { plate: 'aaa111', score: 0.2 },
            ],
            box: CORNER_BOX,
          }),
          // The same two readings from a different box, so both spellings tie
          // on photos and centrality and the score is the deciding tie-break.
          alprResult({
            plate: ' zzz999 ',
            score: 0.1,
            candidates: [
              { plate: 'zzz999 ', score: 0.9 },
              { plate: 'aaa111', score: 0.2 },
            ],
            box: CENTRED_BOX,
          }),
        ],
      }),
    });

    const violations = groupAttachmentsByViolation([photo]);

    expect(violations).toHaveLength(1);
    // Without trimming, the padded `ZZZ999` readings lose their scores and
    // `AAA111` wins on its candidate's 0.2; with trimming, `ZZZ999`'s 0.9 wins.
    expect(violations[0].plate).toBe('ZZZ999');
  });

  test('removes whitespace inside plate strings before the score tie-break', () => {
    const photo = buildPhoto({
      name: 'spaced.jpg',
      createDateMs: 1000,
      plateResults: alprResponse({
        ...SQUARE,
        results: [
          alprResult({
            plate: ' z z z 9 9 9 ',
            score: 0.1,
            candidates: [
              { plate: 'zzz 999', score: 0.9 },
              { plate: 'aaa111', score: 0.2 },
            ],
            box: CORNER_BOX,
          }),
          // The same two readings from a different box, so both spellings tie
          // on photos and centrality and the score is the deciding tie-break.
          alprResult({
            plate: ' z z z 9 9 9 ',
            score: 0.1,
            candidates: [
              { plate: 'zzz 999', score: 0.9 },
              { plate: 'aaa111', score: 0.2 },
            ],
            box: CENTRED_BOX,
          }),
        ],
      }),
    });

    const violations = groupAttachmentsByViolation([photo]);

    expect(violations).toHaveLength(1);
    // Without removing the inner spaces, the `ZZZ999` readings lose their
    // scores and `AAA111` wins on its candidate's 0.2.
    expect(violations[0].plate).toBe('ZZZ999');
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
      // The first frame reads the medallion, the `lda8765` car and a third car.
      // The `lda8765` read is shared with photos 4 and 5, so the frame is
      // evidence for two cars and stays a violation of its own. Its own plate
      // is the medallion, the read nearest its centre.
      { plate: 'T696817C', photos: ['1.jpg'] },
      { plate: 'T696817C', photos: ['2.jpg', '3.jpg'] },
      { plate: 'LDA8765', photos: ['4.jpg', '5.jpg'] },
      { plate: '', photos: ['6.jpg'] },
    ]);

    const [firstFrame, medallion, later, unread] = violations;
    expect(firstFrame.createDateMs).toBe(startTime);
    expect(medallion.createDateMs).toBe(startTime + 4000);
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

describe('the report cap', () => {
  const photoAt = (name, secondsFromStart) =>
    buildPhoto({
      name,
      createDateMs: 1_000_000 + secondsFromStart * 1000,
      plateResults: alprResponse({
        results: [alprResult({ plate: 'aaa111', box: CENTRED_BOX })],
      }),
    });

  test('splits one car’s photos into groups of three', () => {
    // Four pictures of one car: one report carries three, so the fourth starts
    // a report of its own rather than disappearing.
    const photos = ['a', 'b', 'c', 'd'].map((letter, index) =>
      photoAt(`${letter}.jpg`, index),
    );

    const violations = groupAttachmentsByViolation(photos);

    expect(
      violations.map(violation => violation.photos.map(photo => photo.name)),
    ).toEqual([['a.jpg', 'b.jpg', 'c.jpg'], ['d.jpg']]);
    // Both parts are photos of the same car, so both carry its plate.
    expect(violations.map(violation => violation.plate)).toEqual([
      'AAA111',
      'AAA111',
    ]);
  });

  test('keeps three pictures and three videos in one report', () => {
    const photos = [
      ...['a', 'b', 'c'].map((letter, index) =>
        photoAt(`${letter}.jpg`, index),
      ),
      ...['d', 'e', 'f'].map((letter, index) =>
        photoAt(`${letter}.mp4`, index + 3),
      ),
    ];

    const violations = groupAttachmentsByViolation(photos);

    expect(violations).toHaveLength(1);
    expect(violations[0].photos.map(photo => photo.name)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.mp4',
      'e.mp4',
      'f.mp4',
    ]);
  });

  test('counts each kind against its own limit', () => {
    const photos = [
      ...['a', 'b', 'c', 'd'].map((letter, index) =>
        photoAt(`${letter}.jpg`, index),
      ),
      ...['e', 'f', 'g', 'h'].map((letter, index) =>
        photoAt(`${letter}.mp4`, index + 4),
      ),
    ];

    const violations = groupAttachmentsByViolation(photos);

    // Three pictures fill the first report. The fourth rides with three videos
    // in the second, and the last video is left for a third.
    expect(
      violations.map(violation => violation.photos.map(photo => photo.name)),
    ).toEqual([
      ['a.jpg', 'b.jpg', 'c.jpg'],
      ['d.jpg', 'e.mp4', 'f.mp4', 'g.mp4'],
      ['h.mp4'],
    ]);
    expect(violations.map(violation => violation.plate)).toEqual([
      'AAA111',
      'AAA111',
      'AAA111',
    ]);
  });

  test('does not split a row the user merged', () => {
    const photosFor = (letters, firstSecond) =>
      letters.map((letter, index) =>
        photoAt(`${letter}.jpg`, firstSecond + index),
      );
    const [first] = groupAttachmentsByViolation(photosFor(['a', 'b', 'c'], 0));
    const [second] = groupAttachmentsByViolation(
      photosFor(['d', 'e', 'f'], 60),
    );
    expect(first.photos).toHaveLength(3);
    expect(second.photos).toHaveLength(3);

    const merged = mergeViolations([first, second]);

    // A hand merge is the user's report, even when it holds more than one
    // report's worth of photos; the picker and Submit handle that.
    expect(merged.photos).toHaveLength(6);
  });
});
