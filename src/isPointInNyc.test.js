/**
 * @jest-environment node
 */

import PolygonLookup from 'polygon-lookup';

import boroughBoundariesFeatureCollection from './boroughBoundaries.js';
import { isPointInNyc } from './isPointInNyc.js';

const lookup = new PolygonLookup(boroughBoundariesFeatureCollection);

// Regression test: coordinates over water (on bridges, etc.) used to be
// reported as outside NYC because the borough boundaries were clipped to the
// shoreline and didn't include bodies of water.
describe('isPointInNyc', () => {
  test.each([
    // Reported by a user on a bridge over Jamaica Bay.
    ['a bridge over Jamaica Bay', 40.64091111111111, -73.834175],
    ['the George Washington Bridge mid-span', 40.851, -73.952],
    ['the Verrazzano Bridge mid-span', 40.606, -74.044],
    ['the RFK (Triboro) Bridge', 40.783, -73.924],
    ['the Throgs Neck Bridge', 40.801, -73.793],
    ['the Marine Parkway Bridge', 40.572, -73.884],
    ['the Henry Hudson Bridge', 40.875, -73.921],
    ['the Hudson River off Manhattan', 40.765, -74.001],
    ['Upper New York Bay off Staten Island', 40.642, -74.062],
  ])('returns true for %s (was: outside NYC)', (label, latitude, longitude) => {
    expect(isPointInNyc({ lookup, end: { latitude, longitude } })).toBe(true);
  });

  test.each([
    ['Times Square', 40.758, -73.9855],
    ['Coney Island', 40.575, -73.971],
    ['Flushing Meadows', 40.74, -73.841],
  ])('still returns true for %s', (label, latitude, longitude) => {
    expect(isPointInNyc({ lookup, end: { latitude, longitude } })).toBe(true);
  });

  test.each([
    ['Jersey City', 40.728, -74.077],
    ['Newark', 40.735, -74.172],
    ['Yonkers', 40.931, -73.899],
    ['Great Neck, Long Island', 40.801, -73.727],
    ['Mount Vernon', 40.9126, -73.8372],
    ['the ocean, far from shore', 40.5, -73.5],
  ])('still returns false for %s', (label, latitude, longitude) => {
    expect(isPointInNyc({ lookup, end: { latitude, longitude } })).toBe(false);
  });
});
