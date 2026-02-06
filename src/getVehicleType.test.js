/**
 * @jest-environment node
 */
/* eslint-env jest */

import getVehicleType from './getVehicleType.js';

describe('getVehicleType', () => {
  test('returns the right object', async () => {
    const result = await getVehicleType({
      licensePlate: 'TEST',
      licenseState: 'NY',
    });

    expect(result).toMatchSnapshot();
  });
});
