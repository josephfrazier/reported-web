/**
 * @jest-environment node
 */
/* eslint-env jest */

import { validateLocation, processValidation } from './geoclient.js';

describe('validateLocation', () => {
  test('returns the right object', async () => {
    const result = await validateLocation({
      lat: 40.713007655065155,
      long: -74.00592677275506,
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
      lat: '40.772204329580426',
      long: '-73.92590668144963',
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
        lat: 0,
        long: 0,
      }),
    ).rejects.toThrow('could not reverse-geocode lat/long pair (0, 0)');
  }, 10000);
});
