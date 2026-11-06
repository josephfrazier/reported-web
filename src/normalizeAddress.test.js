import normalizeAddress from './normalizeAddress.js';

describe('normalizeAddress', () => {
  test('uppercases', () => {
    expect(normalizeAddress('146 hoyt street')).toBe('146 HOYT STREET');
  });

  test('expands street suffixes', () => {
    expect(normalizeAddress('127 Bergen St')).toBe('127 BERGEN STREET');
    expect(normalizeAddress('146 Hoyt St.')).toBe('146 HOYT STREET');
    expect(normalizeAddress('3521 Riverdale Ave')).toBe(
      '3521 RIVERDALE AVENUE',
    );
  });

  test('uses only the part before the first comma', () => {
    expect(normalizeAddress('127 Bergen St, Brooklyn, NY 11201, USA')).toBe(
      '127 BERGEN STREET',
    );
  });

  test('expands directions and ordinals', () => {
    expect(normalizeAddress('W 34th St')).toBe('WEST 34 STREET');
    expect(normalizeAddress('100-04 89th Ave')).toBe('100-04 89 AVENUE');
  });

  test('returns an empty string for no address', () => {
    expect(normalizeAddress()).toBe('');
    expect(normalizeAddress('')).toBe('');
  });
});
