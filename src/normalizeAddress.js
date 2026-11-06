// Normalize a street address for comparison, so that "127 Bergen St" and
// "127 BERGEN STREET" are equal. Addresses come from different sources
// (e.g. Google's search box and geosearch feature names) with different
// casing and abbreviations.

const STREET_SUFFIXES = {
  ST: 'STREET',
  AVE: 'AVENUE',
  BLVD: 'BOULEVARD',
  RD: 'ROAD',
  DR: 'DRIVE',
  LN: 'LANE',
  PL: 'PLACE',
  PKWY: 'PARKWAY',
  HWY: 'HIGHWAY',
  TER: 'TERRACE',
  CT: 'COURT',
  SQ: 'SQUARE',
  PLZ: 'PLAZA',
  EXPY: 'EXPRESSWAY',
};

const DIRECTIONS = {
  N: 'NORTH',
  S: 'SOUTH',
  E: 'EAST',
  W: 'WEST',
  NE: 'NORTHEAST',
  NW: 'NORTHWEST',
  SE: 'SOUTHEAST',
  SW: 'SOUTHWEST',
};

export default function normalizeAddress(address = '') {
  const streetAddress = address.split(',')[0];

  const tokens = streetAddress
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      const withoutPeriod = token.replace(/\.$/, '');

      // Expand street suffixes and directions, e.g. "ST" -> "STREET",
      // "W" -> "WEST". Check ordinals first so "21ST" stays "21" instead
      // of becoming "21STREET".
      const ordinal = withoutPeriod.match(/^(\d+)(?:ST|ND|RD|TH)$/);
      if (ordinal) {
        return ordinal[1];
      }
      return (
        STREET_SUFFIXES[withoutPeriod] ||
        DIRECTIONS[withoutPeriod] ||
        withoutPeriod
      );
    });

  return tokens.join(' ');
}
