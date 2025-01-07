/**
 * @jest-environment node
 */
/* eslint-env jest */

import { validateLocation, processValidation } from './geoclient.js';

describe('validateLocation', () => {
  test('returns the right object around the Empire State Building', async () => {
    const result = await validateLocation({
      lat: 40.748817,
      long: -73.985428,
    });

    expect(result).toMatchSnapshot();
  });
});

describe('processValidation', () => {
  test('returns the right object', async () => {
    const result = await processValidation({
      lat: 40.7128,
      long: -74.006,
    });

    expect(result).toMatchSnapshot();
  });

  test('returns the right object for string lat/long', async () => {
    const result = await processValidation({
      lat: '40.7128',
      long: '-74.006',
    });

    expect(result).toMatchSnapshot();
  });

  test('returns the right object around 3521-3501 Riverdale Ave, The Bronx, NY 10463', async () => {
    const result = await processValidation({
      lat: 40.88067222222222,
      long: -73.91039722222223,
    });

    expect(result).toMatchSnapshot();
  });

  test('returns an error when no address is found after spiraling', async () => {
    await expect(
      processValidation({
        lat: 40.6435893,
        long: -73.7820064,
        validateLocationImplementation: async () => ({ valid: false }),
      }),
    ).rejects.toThrow(
      'could not reverse-geocode lat/long pair (40.6435893, -73.7820064)',
    );
  });
});
