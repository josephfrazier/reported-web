/**
 * @jest-environment node
 */
/* eslint-env jest */

import { debouncedGetVehicleType } from './plateService.js';

// Mock axios
jest.mock('axios');

describe('plateService', () => {
  test('debouncedGetVehicleType is a function', () => {
    expect(typeof debouncedGetVehicleType).toBe('function');
  });

  test('debouncedGetVehicleType returns a promise', () => {
    const result = debouncedGetVehicleType({
      plate: 'ABC123',
      licenseState: 'NY',
    });
    expect(result).toBeInstanceOf(Promise);
  });
});
