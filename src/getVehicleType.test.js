/**
 * @jest-environment node
 */
/* eslint-env jest */

import getVehicleType, { closeBrowser } from './getVehicleType.js';

const timeoutMilliseconds = 10 * 1000;

describe('getVehicleType', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  test('returns the right object', async () => {
    const result = await getVehicleType({
      licensePlate: 'TEST',
      licenseState: 'NY',
    });

    expect(result).toMatchSnapshot();
  }, timeoutMilliseconds);
});
