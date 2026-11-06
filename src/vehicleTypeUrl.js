import { licenseStateName } from './usStateNames.js';

export default function vehicleTypeUrl({ licensePlate, licenseState }) {
  // A state the dataset has no name for has no page on the site either, but
  // the fallback to the code keeps the URL well-formed rather than throwing on
  // an undefined name.
  const stateName = licenseStateName(licenseState)
    .toLowerCase()
    .replace(/ /g, '-');

  return `https://www.lookupaplate.com/${stateName}/${licensePlate}/`;
}
