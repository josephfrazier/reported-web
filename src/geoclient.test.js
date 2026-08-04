/**
 * @jest-environment node
 */

import { geosearch } from './geoclient.js';

describe('geosearch', () => {
  test('returns the right object around the Empire State Building', async () => {
    const result = await geosearch({
      lat: 40.748817,
      long: -73.985428,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object', async () => {
    const result = await geosearch({
      lat: 40.7128,
      long: -74.006,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object for string lat/long', async () => {
    const result = await geosearch({
      lat: '40.7128',
      long: '-74.006',
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object around 3521 Riverdale Ave, The Bronx, NY 10463', async () => {
    const result = await geosearch({
      lat: 40.88067222222222,
      long: -73.91039722222223,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });
});
