/**
 * Utility functions for the Home component
 */

import axios from 'axios';
import promisedLocation from 'promised-location';

/**
 * Map over object entries, transforming values
 * @param {Object} obj - The object to map over
 * @param {Function} fn - Transform function (value, key, index) => newValue
 * @returns {Object} New object with transformed values
 */
export const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

/**
 * Convert a JavaScript Date to ISO format without seconds
 * @param {Date} jsDate - The date to convert
 * @returns {string} ISO string truncated to minutes (YYYY-MM-DDThh:mm)
 */
export const jsDateToCreateDate = jsDate =>
  jsDate.toISOString().replace(/:\d\d\..*/g, '');

/**
 * Get user's current location via device geolocation or IP fallback
 * @returns {Promise<{coords: {latitude: number, longitude: number}, ipProvenance?: string}>}
 */
export const geolocate = () =>
  promisedLocation().catch(async () => {
    const { data } = await axios.get('https://ipapi.co/json');
    const { latitude, longitude } = data;
    return {
      coords: { latitude, longitude },
      ipProvenance: 'https://ipapi.co/json',
    };
  });
