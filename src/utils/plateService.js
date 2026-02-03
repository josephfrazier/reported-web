/**
 * Plate Lookup Service
 * Extracted from Home.js for better modularity and testability
 */

import axios from 'axios';
import debounce from 'debounce-promise';

// eslint-disable-next-line import/prefer-default-export
export const debouncedGetVehicleType = debounce(
  ({ plate, licenseState }) =>
    axios.get(`/getVehicleType/${plate}/${licenseState}`),
  1000,
);
