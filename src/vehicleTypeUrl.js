import usStateNames from 'datasets-us-states-abbr-names';

usStateNames.DC = 'District of Columbia';

export default function vehicleTypeUrl({ licensePlate, licenseState }) {
  // The dataset holds the 50 states, and DC is added above. A state it has no
  // name for has no page on the site either, but falling back to the code
  // keeps the URL well-formed instead of throwing on an undefined name.
  const stateName = (usStateNames[licenseState] ?? licenseState)
    .toLowerCase()
    .replace(/ /g, '-');

  return `https://www.lookupaplate.com/${stateName}/${licensePlate}/`;
}
