/**
 * @jest-environment node
 */
/* eslint-env jest */

import getVehicleType from './getVehicleType';

describe('getVehicleType', () => {
  test('returns the right object', async () => {
    const result = await getVehicleType({
      licensePlate: 'T716540C',
      licenseState: 'NY',
    });

    expect(result).toMatchSnapshot();
  });
});
