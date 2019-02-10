/**
 * @jest-environment node
 */
/* eslint-env jest */

import { validateLocation, processValidation } from './geoclient.js';

describe('validateLocation', () => {
  test('returns the right object', async () => {
    const result = await validateLocation({
      lat: 40.7128,
      long: -74.006,
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
});
