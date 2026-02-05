/**
 * Geolocation Service
 * Extracted from Home.js for better modularity and testability
 */

import axios from 'axios';
import promisedLocation from 'promised-location';
import debounce from 'debounce-promise';
import PolygonLookup from 'polygon-lookup';

import { getBoroNameMemoized } from '../getBoroName.js';

export const geolocate = () =>
  promisedLocation().catch(async () => {
    const { data } = await axios.get('https://ipapi.co/json');
    const { latitude, longitude } = data;
    return {
      coords: { latitude, longitude },
      ipProvenance: 'https://ipapi.co/json',
    };
  });

export const debouncedProcessValidation = debounce(
  async ({ latitude, longitude }) => {
    const { data } = await axios.post('/api/process_validation', {
      lat: latitude,
      long: longitude,
    });
    return data;
  },
  500,
);

export function validateNycBoundary({
  latitude,
  longitude,
  boroughBoundariesFeatureCollection,
}) {
  console.time('new PolygonLookup'); // eslint-disable-line no-console
  const lookup = new PolygonLookup(boroughBoundariesFeatureCollection);
  console.timeEnd('new PolygonLookup'); // eslint-disable-line no-console

  const end = { latitude, longitude };
  const BoroName = getBoroNameMemoized({ lookup, end });

  const coordsAreInNyc = BoroName !== '(unknown borough)';

  if (!coordsAreInNyc) {
    const errorMessage = `latitude/longitude (${latitude}, ${longitude}) is outside NYC. Please select a location within NYC.`;
    return {
      coordsAreInNyc: false,
      errorMessage,
    };
  }

  return {
    coordsAreInNyc: true,
    BoroName,
  };
}
