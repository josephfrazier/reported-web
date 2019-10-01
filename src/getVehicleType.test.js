/**
 * @jest-environment node
 */
/* eslint-env jest */

import getVehicleType from './getVehicleType.js';

describe('getVehicleType', () => {
  test('returns the right object', async () => {
    const result = await getVehicleType({
      licensePlate: 'T716540C',
      licenseState: 'NY',
    });

    expect(result).toMatchInlineSnapshot(`
Object {
  "result": Object {
    "licensePlate": "T716540C",
    "licenseState": "NY",
    "vehicleBody": "Sedan/Saloon",
    "vehicleMake": "LINCOLN",
    "vehicleModel": "Town Car",
    "vehicleYear": "2009",
  },
}
`);
  });
});
