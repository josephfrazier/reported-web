/**
 * @jest-environment node
 */

import formatGeosearchAddress from './formatGeosearchAddress.js';

describe('formatGeosearchAddress', () => {
  test('formats an address with a housenumber', () => {
    expect(
      formatGeosearchAddress({
        housenumber: '309',
        street: 'GOLD STREET',
        borough: 'Brooklyn',
      }),
    ).toBe('309 Gold Street, Brooklyn');
  });

  test('formats a venue without a housenumber', () => {
    expect(
      formatGeosearchAddress({
        street: 'R INGERSOLL HOUSES BUILDING 23',
        borough: 'Brooklyn',
      }),
    ).toBe('R Ingersoll Houses Building 23, Brooklyn');
  });

  test('formats an address without a street', () => {
    expect(
      formatGeosearchAddress({ housenumber: '309', borough: 'Brooklyn' }),
    ).toBe('309, Brooklyn');
  });

  test('formats an empty result', () => {
    expect(formatGeosearchAddress({})).toBe('');
  });
});
