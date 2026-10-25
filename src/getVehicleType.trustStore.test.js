/**
 * @jest-environment node
 */

import { createSession } from 'wreq-js';
import getVehicleType from './getVehicleType.js';

jest.mock('wreq-js', () => ({
  createSession: jest.fn(),
}));

describe('getVehicleType', () => {
  test('uses the operating-system trust store', async () => {
    createSession.mockResolvedValue({
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { licensePlate: {} } }),
      }),
    });

    await getVehicleType({ licensePlate: 'ABC123', licenseState: 'NY' });

    expect(createSession).toHaveBeenCalledWith({
      browser: 'firefox_151',
      os: 'macos',
      trustStore: 'defaultPaths',
    });
  });
});
