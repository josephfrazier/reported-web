import usStateNames from 'datasets-us-states-abbr-names';

usStateNames.DC = 'District of Columbia';

export default function vehicleTypeUrl({ licensePlate, licenseState }) {
  const stateName = usStateNames[licenseState].toLowerCase().replace(' ', '-');

  return `https://www.lookupaplate.com/${stateName}/${licensePlate}/`;
}
