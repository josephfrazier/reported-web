/**
 * Group one record per processed photo into one record per violation.
 *
 * Semi-automatic mode runs ALPR, date and location extraction over a whole
 * batch of photos, then hands the results here. Grouping has to happen before
 * anything is filled in, because the form is filled in per violation rather
 * than per photo.
 *
 * One photo is one violation until a plate says otherwise. Time and place
 * cannot tell the cars apart: cars parked along one block stand a few seconds
 * and a few metres apart, so two photos of two cars can be closer together
 * than two photos of one car. The plate is the signal that names the car, so
 * it is the only signal the grouping merges on.
 *
 * The passes, in this order:
 *
 *   1. Sort by capture time. The queue walks the batch in the order it was
 *      shot, and a violation takes its time from its earliest photo.
 *   2. Fold plate strings. Plate Recognizer ranks its own alternatives in
 *      `candidates`, so the four ways it reads one medallion are one plate,
 *      not four. Folding is a union-find over strings, with an edge for every
 *      pair a single result offers.
 *   3. Pick each photo's own plate. A photo can read several plates -- a
 *      closeup of one car with another parked behind it. The result the read
 *      named is the answer: a medallion result if the read offered one, and
 *      the first result otherwise, which is the rule the form applies to the
 *      same read.
 *   4. Merge photos that name the same plate, unless one of them reads
 *      another plate that a different photo also read. Such a photo is
 *      evidence for two cars, and giving it to one row takes it from the
 *      other, so it stays a violation of its own.
 *   5. Split on the report's cap. A report carries three pictures and three
 *      videos at most, so a violation over either count becomes consecutive
 *      groups, in capture order, that fit. Every photo of a violation reads
 *      the plate it reports, so each part keeps that plate.
 *
 * A photo ALPR read nothing in is a violation of its own, flagged for manual
 * entry. The user can merge it with its car by hand; nothing else knows which
 * car that is.
 *
 * Capture order is not defined here: `compareByCaptureTime` and
 * `effectiveTimeMs` come from `latestLocatedPhoto.js`, which sorts the form's
 * photos the same way.
 *
 * The caller's photo records are used as they are, never copied, so object
 * identity survives: `violation.photos[i].file` is still the same `File` the
 * ALPR cache and the background uploads are keyed on.
 *
 * in:  [{ file, name, createDateMs, latitude, longitude,
 *         plateResults, uploadWidth, uploadHeight }]
 * out: [{ photos[], plate, licenseState,
 *         latitude, longitude, createDateMs }]
 */

import fileExtension from 'file-extension';

import { isImage, isVideo } from './isImage.js';
import latestLocatedPhoto, {
  compareByCaptureTime,
  effectiveTimeMs,
} from './latestLocatedPhoto.js';

// A report carries three pictures and three videos at most: `createSubmission`
// keeps exactly that many of each and drops the rest without an error. A
// violation over either count is split into consecutive groups that fit.
const REPORT_LIMITS = { picture: 3, video: 3 };

// The medallion plate pattern, kept as a tie-break rather than a filter: only
// the clean read of an OCR variant set matches it, so using it to pick a plate
// would throw away the variants that make folding possible.
// https://github.com/josephfrazier/reported-web/issues/584
const MEDALLION_PLATE = /^T\d{6}C$/;

// How far a plate's box sits from the centre of the frame it was found in,
// as a fraction of the frame's diagonal, or null when it cannot be computed.
//
// `box` is in the pixel space of the image uploaded to Plate Recognizer (see
// src/alpr.js), so raw pixels are not comparable between a 4096-wide and a
// 2048-wide photo. Normalising by the frame diagonal makes them comparable
// whatever their size, and whatever their aspect ratio -- which dividing the
// two offsets by the width and the height separately would not.
export function normalizedCenterDistance(box, uploadWidth, uploadHeight) {
  if (!box || !uploadWidth || !uploadHeight) {
    return null;
  }
  const centerX = (box.xmin + box.xmax) / 2;
  const centerY = (box.ymin + box.ymax) / 2;
  return (
    Math.hypot(centerX - uploadWidth / 2, centerY - uploadHeight / 2) /
    Math.hypot(uploadWidth, uploadHeight)
  );
}

// Every plate string a single result could be read as: the winner ALPR picked
// plus the ranked alternatives it offered alongside it.
//
// A plate means the same thing however it is spaced: NYC 311 ignores
// whitespace, and the reader's strings come back compact. Remove all of it,
// not just the ends, so "ab c 123" and "ABC123" name the same plate.
const normalizePlate = plate =>
  typeof plate === 'string' ? plate.replace(/\s+/g, '').toUpperCase() : '';

function candidatePlateStrings(result) {
  const plates = [
    result.plate,
    ...(result.candidates || []).map(candidate => candidate?.plate),
  ]
    .map(normalizePlate)
    .filter(Boolean);

  return [...new Set(plates)];
}

function scoreOfPlate({ result, plate }) {
  let score = normalizePlate(result.plate) === plate ? result.score || 0 : 0;
  (result.candidates || []).forEach(candidate => {
    if (
      normalizePlate(candidate?.plate) === plate &&
      Number.isFinite(candidate.score)
    ) {
      score = Math.max(score, candidate.score);
    }
  });
  return score;
}

function meanCenterDistance(boxes) {
  const distances = boxes
    .map(({ box, uploadWidth, uploadHeight }) =>
      normalizedCenterDistance(box, uploadWidth, uploadHeight),
    )
    .filter(distance => distance !== null);

  if (distances.length === 0) {
    return Infinity;
  }
  return (
    distances.reduce((total, distance) => total + distance, 0) /
    distances.length
  );
}

// Per plate string: which photos could be reading it, the boxes it was found
// in, and the best score ALPR gave it.
function buildPlateStats(photos) {
  const parents = new Map();
  const find = plate => {
    let root = plate;
    while (parents.get(root) !== root) {
      root = parents.get(root);
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parents.set(rootB, rootA);
    }
  };

  const stats = new Map();

  photos.forEach(photo => {
    const results = photo.plateResults?.results || [];
    results.forEach(result => {
      const plates = candidatePlateStrings(result);
      if (plates.length === 0) {
        return;
      }

      plates.forEach(plate => {
        if (!parents.has(plate)) {
          parents.set(plate, plate);
        }
      });

      // The union-find edges all come from one result's own candidate set:
      // Plate Recognizer ranks its own alternatives there, so a set like
      // ["t696817c", "t6968i7c", "t696b17c", "t696bi7c"] is one medallion read
      // four ways, not four plates. No invented edit distance, and no folding
      // across results that never offered the same string.
      const [first, ...rest] = plates;
      rest.forEach(plate => union(first, plate));

      plates.forEach(plate => {
        if (!stats.has(plate)) {
          stats.set(plate, { photos: new Set(), boxes: [], score: 0 });
        }
        const stat = stats.get(plate);
        stat.photos.add(photo);
        // `box` is per result, so a photo that read the same plate twice
        // contributes one distance per reading.
        stat.boxes.push({
          box: result.box,
          uploadWidth: photo.uploadWidth,
          uploadHeight: photo.uploadHeight,
        });
        stat.score = Math.max(stat.score, scoreOfPlate({ result, plate }));
      });
    });
  });

  return { stats, find };
}

// The four tie-breaks from the plan, in order, each applied only while the one
// before it is still tied: most photos, most central, medallion plate, highest
// score. Sorted best-first.
function compareStats(a, b) {
  if (a.photoCount !== b.photoCount) {
    return b.photoCount - a.photoCount;
  }
  if (a.meanCenterDistance !== b.meanCenterDistance) {
    return a.meanCenterDistance - b.meanCenterDistance;
  }
  if (a.matchesMedallion !== b.matchesMedallion) {
    return a.matchesMedallion ? -1 : 1;
  }
  return b.score - a.score;
}

function statsForPlate(plate, stat) {
  return {
    photoCount: stat.photos.size,
    meanCenterDistance: meanCenterDistance(stat.boxes),
    matchesMedallion: MEDALLION_PLATE.test(plate),
    score: stat.score,
  };
}

// A folded variant group is the unit the vote actually picks: every string in
// it is a reading of the same plate, so their photos, distances and scores are
// pooled.
function statsForPlateGroup(members, stats) {
  const photos = new Set();
  const boxes = [];
  let score = 0;
  let matchesMedallion = false;

  members.forEach(plate => {
    const stat = stats.get(plate);
    stat.photos.forEach(photo => photos.add(photo));
    boxes.push(...stat.boxes);
    score = Math.max(score, stat.score);
    if (MEDALLION_PLATE.test(plate)) {
      matchesMedallion = true;
    }
  });

  return {
    photoCount: photos.size,
    meanCenterDistance: meanCenterDistance(boxes),
    matchesMedallion,
    score,
  };
}

function buildPlateGroups({ stats, find }) {
  const membersByRoot = new Map();
  stats.forEach((stat, plate) => {
    const root = find(plate);
    if (!membersByRoot.has(root)) {
      membersByRoot.set(root, []);
    }
    membersByRoot.get(root).push(plate);
  });

  return [...membersByRoot.values()].map(members => ({
    members,
    stats: statsForPlateGroup(members, stats),
  }));
}

// Which spelling a row prints for its plate, and which group wins when the
// caller offers more than one. Ties that survive all four tie-breaks fall
// back to the group the earliest photo voted for, then to the alphabetically
// first reading, so the same batch always groups the same way.
function pickWinner({ groups, cluster, stats }) {
  const indexOfPhoto = new Map(cluster.map((photo, index) => [photo, index]));
  const earliestPhotoIndexOf = group =>
    Math.min(
      ...group.members.flatMap(plate =>
        [...stats.get(plate).photos].map(photo => indexOfPhoto.get(photo)),
      ),
    );
  const smallestMemberOf = group => [...group.members].sort()[0];

  const winner = [...groups].sort(
    (a, b) =>
      compareStats(a.stats, b.stats) ||
      earliestPhotoIndexOf(a) - earliestPhotoIndexOf(b) ||
      smallestMemberOf(a).localeCompare(smallestMemberOf(b)),
  )[0];

  // The vote picks the folded group; the string reported for it is the group's
  // own best reading, by the same tie-breaks. In the checked-in ALPR snapshot
  // that is the clean `t696817c` read, the only variant matching the medallion
  // pattern -- the variants are what fold, not what gets reported.
  const plate = [...winner.members].sort(
    (a, b) =>
      compareStats(
        statsForPlate(a, stats.get(a)),
        statsForPlate(b, stats.get(b)),
      ) || a.localeCompare(b),
  )[0];

  return { members: winner.members, plate };
}

function licenseStateForPlate({ photos, plate }) {
  const results = photos.flatMap(photo => photo.plateResults?.results || []);
  const namesPlate = result => normalizePlate(result.plate) === plate;
  const candidatesPlate = result =>
    candidatePlateStrings(result).includes(plate);

  // Prefer a result whose own plate is the one reported, then one that offered
  // it as a candidate. Try each in turn: a result can lack a parseable region,
  // and a later reading of the same plate may still name the state.
  const matching = [
    ...results.filter(namesPlate),
    ...results.filter(result => !namesPlate(result) && candidatesPlate(result)),
  ];

  for (const result of matching) {
    try {
      const state = result.region.code.split('-')[1];
      if (state) {
        return state.toUpperCase();
      }
    } catch {
      // This result has no parseable region; try the next reading.
    }
  }

  return '';
}

// Where a row's plate was seen: the first photo with a result that reads it,
// the box that result put it in, and the pixel size the box is measured in.
// The queue draws this crop in place of the plate's text.
//
// The plate is matched the way the vote matches it -- the result's own plate
// first, then the candidates that fold OCR variants together -- and the box is
// measured in the uploaded frame, which is what `uploadWidth`/`uploadHeight`
// carry (see `normalizedCenterDistance`).
export function plateCropFor({ photos, plate }) {
  if (!plate) {
    return null;
  }

  const wanted = normalizePlate(plate);

  for (const photo of photos) {
    const plateResults = photo.plateResults || {};
    const results = plateResults.results || [];
    const matching = [
      ...results.filter(r => normalizePlate(r.plate) === wanted),
      ...results.filter(
        r =>
          normalizePlate(r.plate) !== wanted &&
          candidatePlateStrings(r).includes(wanted),
      ),
    ];
    const width =
      photo.uploadWidth || plateResults.uploadWidth || plateResults.image_width;
    const height =
      photo.uploadHeight ||
      plateResults.uploadHeight ||
      plateResults.image_height;

    for (const result of matching) {
      const { box } = result;

      // A box with no area cannot be cut out, and the crop's own arithmetic
      // divides by its sides. Try the next reading in this photo; a later
      // result can carry the box the first one lacks.
      if (
        box &&
        box.xmax > box.xmin &&
        box.ymax > box.ymin &&
        width &&
        height
      ) {
        return { photo, box, width, height };
      }
    }
  }

  return null;
}

// The plate group a photo is a photo *of*: the result the read named, chosen
// the way the form chooses one -- a medallion result if the read offered one,
// and the first result otherwise. The group is answered as the union-find
// root, so two spellings that fold together answer the same group.
function chosenPlateGroupOf({ photo, find }) {
  const results = photo.plateResults?.results || [];
  const result =
    results.find(each => MEDALLION_PLATE.test(normalizePlate(each.plate))) ||
    results[0];
  const plate = normalizePlate(result?.plate);
  const root = plate ? find(plate) : undefined;

  return root === undefined ? null : root;
}

// The plate groups a photo read that another photo also read. A photo with two
// of these shows two cars, and each plate is somebody else's evidence too, so
// the photo cannot be given to one of them.
function sharedPlateGroupsOf({ photo, find, photosByRoot }) {
  const roots = new Set();

  (photo.plateResults?.results || []).forEach(result => {
    candidatePlateStrings(result).forEach(plate => {
      roots.add(find(plate));
    });
  });

  return [...roots].filter(root => photosByRoot.get(root).size > 1);
}

// The group every plate reading is pooled into, and the photos that read each
// one.
function buildPlateReadings(photos) {
  const { stats, find } = buildPlateStats(photos);
  const photosByRoot = new Map();

  stats.forEach((stat, plate) => {
    const root = find(plate);
    if (!photosByRoot.has(root)) {
      photosByRoot.set(root, new Set());
    }
    stat.photos.forEach(photo => photosByRoot.get(root).add(photo));
  });

  return { find, photosByRoot };
}

// The plate group a photo merges on, or null when it merges with nothing.
//
// A photo merges only when its own plate is the one plate it shares with
// another photo. If it reads a second shared plate, the photo shows two cars
// and stays a violation of its own. If its own plate is shared with nobody,
// there is nothing to merge with.
function mergeRootOf({ photo, find, photosByRoot }) {
  const primary = chosenPlateGroupOf({ photo, find });

  if (primary === null) {
    return null;
  }

  const shared = sharedPlateGroupsOf({ photo, find, photosByRoot });

  return shared.length === 1 && shared[0] === primary ? primary : null;
}

// One list of photos per violation, in capture order. A photo that merges with
// nothing is a row of its own.
function rowsOfPhotos(sorted) {
  const { find, photosByRoot } = buildPlateReadings(sorted);
  const rowsByRoot = new Map();
  const rows = [];

  sorted.forEach(photo => {
    const root = mergeRootOf({ photo, find, photosByRoot });

    if (root === null) {
      rows.push([photo]);
      return;
    }

    if (!rowsByRoot.has(root)) {
      const row = [];
      rowsByRoot.set(root, row);
      rows.push(row);
    }
    rowsByRoot.get(root).push(photo);
  });

  return rows;
}

// The plate a violation reports, and the state its region code names.
//
// The rule is the form's, and both read it from here so the queue row and the
// field cannot disagree: the first photo in order that named a plate gives the
// group, and a medallion result wins over the result order. The vote then
// chooses the spelling the row prints within that group.
//
// `foldFrom` is the set of photos whose `candidates` fold the strings: the
// whole batch for a row, so a variant read by one photo and its clean spelling
// read by another answer the same group. The chosen group still comes from
// `photos`, so a row with fewer photos than the batch prints its own plate.
export function plateForPhotos(photos, { foldFrom = photos } = {}) {
  const { stats, find: localFind } = buildPlateStats(photos);

  if (stats.size === 0) {
    return { plate: '', licenseState: '' };
  }

  const { find } = buildPlateStats(foldFrom);
  const chosenRoot = photos
    .map(photo => chosenPlateGroupOf({ photo, find }))
    .find(root => root !== null);

  if (chosenRoot === undefined) {
    return { plate: '', licenseState: '' };
  }

  const groups = buildPlateGroups({ stats, find: localFind }).filter(
    group => find(group.members[0]) === chosenRoot,
  );

  if (groups.length === 0) {
    return { plate: '', licenseState: '' };
  }

  const { plate } = pickWinner({
    groups,
    cluster: photos,
    stats,
  });

  return { plate, licenseState: licenseStateForPlate({ photos, plate }) };
}

// The time and the place a violation records, which come from opposite ends of
// its group.
//
// Neither rule lives here. The time is the earliest photo's, which
// `earliestTakenPhoto` reads, and the place is the last photo's that has one,
// which `latestLocatedPhoto` reads -- the same two the form applies to the
// photos it holds, so a violation means the same thing whether it is waiting
// in the queue or loaded into the form.
//
// This is what the violation itself records, and a violation is always
// somewhere at some time: a photo with no capture time falls back to its
// file's, and the place falls back to the first photo when none of them has
// coordinates, so the record is complete even when the photos are not.
function photosSummary(photos) {
  const sorted = [...photos].sort(compareByCaptureTime);
  // The rule itself is `latestLocatedPhoto`'s. This falls back to the first
  // photo when none of them has coordinates, so the form still gets an answer
  // (an empty one) rather than nothing at all.
  const located = latestLocatedPhoto(sorted) || sorted[0];

  return {
    photos: sorted,
    createDateMs: sorted.length ? effectiveTimeMs(sorted[0]) : undefined,
    latitude: located?.latitude,
    longitude: located?.longitude,
  };
}

function buildViolation({ photos, plate, licenseState }) {
  const { photos: sortedPhotos, ...timeAndPlace } = photosSummary(photos);

  return {
    photos: sortedPhotos,
    plate,
    licenseState,
    ...timeAndPlace,
  };
}

// Which of the report's two kinds a photo is, or null for a file that is
// neither: the batch takes pictures, videos and zips, and a zip is opened out
// before grouping.
const reportKindOf = photo => {
  const ext = fileExtension(photo.name);
  if (isImage({ ext })) {
    return 'picture';
  }
  if (isVideo({ ext })) {
    return 'video';
  }
  return null;
};

// One violation, split into as many as the report's caps require. The photos
// keep their capture order, so the earlier group is the earlier part of the
// car's stay. Every photo of a violation reads the plate the violation
// reports, so each part keeps that plate and its state.
function splitAtReportLimits(violation) {
  const counts = { picture: 0, video: 0 };
  violation.photos.forEach(photo => {
    const kind = reportKindOf(photo);
    if (kind) {
      counts[kind] += 1;
    }
  });

  if (
    counts.picture <= REPORT_LIMITS.picture &&
    counts.video <= REPORT_LIMITS.video
  ) {
    return [violation];
  }

  const groups = [];
  let current = [];
  const currentCounts = { picture: 0, video: 0 };

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    groups.push(current);
    current = [];
    currentCounts.picture = 0;
    currentCounts.video = 0;
  };

  violation.photos.forEach(photo => {
    const kind = reportKindOf(photo);
    if (kind && currentCounts[kind] === REPORT_LIMITS[kind]) {
      flush();
    }
    current.push(photo);
    if (kind) {
      currentCounts[kind] += 1;
    }
  });
  flush();

  return groups.map(photos =>
    buildViolation({
      photos,
      plate: violation.plate,
      licenseState: violation.licenseState,
    }),
  );
}

// Combine violations the user says are one report.
//
// The grouping merges only what the plates agree on. A far shot taken to
// establish where a car is can read no plate, and a closeup's read can fail,
// so one car can stand as two violations. Only the user knows they belong
// together, which is why this combines what it is given instead of inferring
// anything.
//
// The photos are merged as they arrive: the grouping has already said these
// are separate rows, and running it again would say so again.
//
// The plate comes from whichever violation read one, and from the one with more
// photos behind it when both did -- the reading the user can see wins.
export function mergeViolations(violations) {
  // Once each. A report holds a picture once, and a hand-built violation can
  // name the same photo twice.
  const photos = [
    ...new Set(violations.flatMap(violation => [...violation.photos])),
  ];

  const [withPlate] = violations
    .filter(violation => violation.plate)
    .sort((a, b) => b.photos.length - a.photos.length);

  // Rows with no photos have no photo to take their time and place from, so
  // the earliest one keeps the record the merged row reports.
  if (photos.length === 0) {
    const [earliest] = [...violations].sort(
      (a, b) => a.createDateMs - b.createDateMs,
    );

    return {
      photos: [],
      plate: withPlate?.plate || '',
      licenseState: withPlate?.licenseState || '',
      createDateMs: earliest?.createDateMs,
      latitude: earliest?.latitude,
      longitude: earliest?.longitude,
    };
  }

  return buildViolation({
    photos,
    plate: withPlate?.plate || '',
    licenseState: withPlate?.licenseState || '',
  });
}

export default function groupAttachmentsByViolation(photos) {
  const sorted = [...photos].sort(compareByCaptureTime);

  const violations = rowsOfPhotos(sorted).map(rowPhotos =>
    buildViolation({
      photos: rowPhotos,
      ...plateForPhotos(rowPhotos, { foldFrom: sorted }),
    }),
  );

  // Earliest-first, so the queue walks the batch in the order it was shot.
  // Array.prototype.sort is stable, so violations sharing a timestamp keep the
  // order their rows were built in.
  return violations
    .flatMap(splitAtReportLimits)
    .sort((a, b) => a.createDateMs - b.createDateMs);
}
