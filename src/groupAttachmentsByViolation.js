/**
 * Group one record per processed photo into one record per violation.
 *
 * Semi-automatic mode runs ALPR, date and location extraction over a whole
 * batch of photos, then hands the results here. Grouping has to happen before
 * anything is filled in, because the form is filled in per violation rather
 * than per photo: several photos of one car are one report, and that report's
 * time and location come from its earliest photo.
 *
 * Four passes, in this order (see docs/plans/semi-automatic-mode.html):
 *
 *   1. Sort by capture time, so everything downstream can assume chronological
 *      order.
 *   2. Cluster by time and place: two photos link when they were taken within
 *      TIME_THRESHOLD_MS of each other and at most
 *      DISTANCE_THRESHOLD_METERS apart. Connected components of that relation
 *      are the candidate violations.
 *   3. Vote the plate, then split on it. Clustering deliberately runs first:
 *      a plate may only ever divide a cluster, never merge two, which keeps it
 *      from both defining a group and being chosen from it.
 *   4. Adopt the photos ALPR read nothing in into whichever sub-cluster is
 *      nearest in capture time, so a blurry shot still rides along with its
 *      violation.
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

const TIME_THRESHOLD_MS = 5000;
const DISTANCE_THRESHOLD_METERS = 30;

// Mean Earth radius (IUGG), the value most haversine implementations use.
const EARTH_RADIUS_METERS = 6371008.8;

// The medallion plate pattern, kept as a tie-break rather than a filter: only
// the clean read of an OCR variant set matches it, so using it to pick a plate
// would throw away the variants that make folding possible.
// https://github.com/josephfrazier/reported-web/issues/584
const MEDALLION_PLATE = /^T\d{6}C$/;

const toRadians = degrees => (degrees * Math.PI) / 180;

// Great-circle distance in meters between two `{ latitude, longitude }` pairs.
export function haversineMeters(a, b) {
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) *
      Math.cos(toRadians(b.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  // Rounding can push `h` a hair above 1 for (near-)antipodal points, which
  // would make Math.sqrt(h) exceed 1 and Math.asin() return NaN.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

const hasCoordinates = ({ latitude, longitude }) =>
  Number.isFinite(latitude) && Number.isFinite(longitude);

// A capture time is the signal that orders a batch, but plenty of photos have
// none -- EXIF stripped, or the file is a scan/screenshot. File last-modified
// is the fallback those photos sort, cluster and report on instead.
const effectiveTimeMs = ({ createDateMs, file }) =>
  Number.isFinite(createDateMs) ? createDateMs : file?.lastModified || 0;

// Photos with a real capture time sort first and in order; photos without one
// sort last, so a batch's unknowns never interleave with its knowns.
//
// Array.prototype.sort is stable, so photos that compare equal keep the order
// the caller passed them in.
function compareByCaptureTime(a, b) {
  const aHasCaptureTime = Number.isFinite(a.createDateMs);
  const bHasCaptureTime = Number.isFinite(b.createDateMs);
  if (aHasCaptureTime !== bHasCaptureTime) {
    return aHasCaptureTime ? -1 : 1;
  }
  return effectiveTimeMs(a) - effectiveTimeMs(b);
}

function linkPhotos(a, b) {
  if (Math.abs(effectiveTimeMs(a) - effectiveTimeMs(b)) > TIME_THRESHOLD_MS) {
    return false;
  }
  // Android strips GPS from media shared through some apps, so a photo with no
  // coordinates still links on capture time alone. Both sides have to have
  // coordinates for distance to mean anything.
  // https://github.com/josephfrazier/reported-web/issues/751
  if (!hasCoordinates(a) || !hasCoordinates(b)) {
    return true;
  }
  return haversineMeters(a, b) <= DISTANCE_THRESHOLD_METERS;
}

// Connected components of `linkPhotos`, oldest first (the input is already
// sorted by capture time, and Map preserves insertion order).
function clusterByTimeAndPlace(photos) {
  const parents = photos.map((photo, index) => index);
  const find = index => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root];
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parents[rootB] = rootA;
    }
  };

  // Every pair, not just neighbours: two shots 5 seconds apart are one cluster
  // even when a third photo between them breaks the chain. Batches are tens of
  // photos, so the quadratic scan is not worth an early exit that the
  // timestamp-less tier would invalidate anyway.
  for (let i = 0; i < photos.length; i += 1) {
    for (let j = i + 1; j < photos.length; j += 1) {
      if (linkPhotos(photos[i], photos[j])) {
        union(i, j);
      }
    }
  }

  const clusters = new Map();
  photos.forEach((photo, index) => {
    const root = find(index);
    if (!clusters.has(root)) {
      clusters.set(root, []);
    }
    clusters.get(root).push(photo);
  });

  return [...clusters.values()];
}

// Every plate string a single result could be read as: the winner ALPR picked
// plus the ranked alternatives it offered alongside it.
function candidatePlateStrings(result) {
  const plates = [
    result.plate,
    ...(result.candidates || []).map(candidate => candidate?.plate),
  ]
    .map(plate => (typeof plate === 'string' ? plate.trim().toUpperCase() : ''))
    .filter(Boolean);

  return [...new Set(plates)];
}

function scoreOfPlate({ result, plate }) {
  let score = result.plate?.toUpperCase() === plate ? result.score || 0 : 0;
  (result.candidates || []).forEach(candidate => {
    if (
      candidate?.plate?.toUpperCase() === plate &&
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

// Which plate the cluster votes for. Ties that survive all four tie-breaks fall
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
  const result =
    results.find(r => r.plate?.toUpperCase() === plate) ||
    results.find(r => candidatePlateStrings(r).includes(plate));

  try {
    return result.region.code.split('-')[1].toUpperCase();
  } catch {
    // ALPR results may not always include a parseable region code.
    return '';
  }
}

const photoHasAnyPlate = (photo, members) =>
  (photo.plateResults?.results || []).some(result =>
    candidatePlateStrings(result).some(plate => members.has(plate)),
  );

// Passes 3 and 4 of one candidate cluster: split it into violations on the
// plate, and hand back whatever is left over.
function splitCluster(cluster) {
  const groups = [];
  let remaining = cluster;

  while (remaining.length > 0) {
    const { stats, find } = buildPlateStats(remaining);
    if (stats.size === 0) {
      break;
    }

    const { members, plate } = pickWinner({
      groups: buildPlateGroups({ stats, find }),
      cluster: remaining,
      stats,
    });
    const memberSet = new Set(members);
    const claimed = remaining.filter(photo =>
      photoHasAnyPlate(photo, memberSet),
    );
    if (claimed.length === 0) {
      break;
    }

    groups.push({
      photos: claimed,
      plate,
      licenseState: licenseStateForPlate({ photos: claimed, plate }),
    });

    const claimedPhotos = new Set(claimed);
    remaining = remaining.filter(photo => !claimedPhotos.has(photo));
  }

  return { groups, orphans: remaining };
}

// Photos ALPR read nothing in still belong to whatever they were shot
// alongside, so give each one to the group nearest in capture time.
//
// A group covers a span of time, so the gap that matters is the one to the
// nearer end of that span: a shot taken between two frames of the same car is
// zero milliseconds from its group, not half the group's length away. The
// spans are measured before any orphan joins, so where orphans land does not
// depend on the order they are placed in.
function adoptOrphans({ orphans, groups }) {
  if (orphans.length === 0 || groups.length === 0) {
    return;
  }

  const spans = groups.map(group => {
    const times = group.photos.map(effectiveTimeMs);
    return { group, start: Math.min(...times), end: Math.max(...times) };
  });
  const gapFrom = ({ time, span }) =>
    Math.max(span.start - time, 0, time - span.end);

  orphans.forEach(orphan => {
    const time = effectiveTimeMs(orphan);
    let nearest = 0;
    spans.forEach((span, index) => {
      if (gapFrom({ time, span }) < gapFrom({ time, span: spans[nearest] })) {
        nearest = index;
      }
    });
    spans[nearest].group.photos.push(orphan);
  });
}

// The form needs one time and one place per violation, so take them from the
// earliest photo in the group: it is the one the report describes.
//
// A photo with no GPS still clusters on time alone, so the earliest photo can
// be missing the very coordinates the report needs. Fall back to the earliest
// photo that has them -- the group's own location, a few metres away at most,
// rather than forcing the user to drop a pin for a violation already located.
function buildViolation({ photos, plate, licenseState }) {
  const sortedPhotos = [...photos].sort(compareByCaptureTime);
  const earliest = sortedPhotos[0];
  const located = sortedPhotos.find(hasCoordinates) || earliest;

  return {
    photos: sortedPhotos,
    plate,
    licenseState,
    latitude: located.latitude,
    longitude: located.longitude,
    createDateMs: effectiveTimeMs(earliest),
  };
}

export default function groupAttachmentsByViolation(photos) {
  const sorted = [...photos].sort(compareByCaptureTime);
  const violations = [];

  clusterByTimeAndPlace(sorted).forEach(cluster => {
    const { groups, orphans } = splitCluster(cluster);

    if (groups.length === 0) {
      // Nothing in the cluster was read at all. Keep it as one violation
      // rather than dropping the photos; the queue flags it for manual entry.
      violations.push(
        buildViolation({ photos: cluster, plate: '', licenseState: '' }),
      );
      return;
    }

    adoptOrphans({ orphans, groups });
    groups.forEach(group => violations.push(buildViolation(group)));
  });

  // Earliest-first, so the queue walks the batch in the order it was shot.
  // Array.prototype.sort is stable, so violations sharing a timestamp keep the
  // order their clusters were built in.
  return violations.sort((a, b) => a.createDateMs - b.createDateMs);
}
