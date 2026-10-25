import usStateNames from 'datasets-us-states-abbr-names';

// The dataset holds the 50 states. DC is not in it, and neither are the
// territories, so this module owns both the patching and the lookups that have
// to cope with a name it does not have. A plate read does not go through the
// list either way: the region code comes off whatever the reader saw, which
// brings Canadian provinces and federal fleet codes here too.
usStateNames.DC = 'District of Columbia';

// The name to show or link by. A state the dataset has no name for falls back
// to its code, so a sentence reads "in ON" rather than stopping at "in ".
export function licenseStateName(licenseState) {
  return usStateNames[licenseState] ?? licenseState;
}

export default usStateNames;
