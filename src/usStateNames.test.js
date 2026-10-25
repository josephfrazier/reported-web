import usStateNames, { licenseStateName } from './usStateNames.js';

describe('licenseStateName', () => {
  test('gives the state name for a state the dataset holds', () => {
    expect(licenseStateName('NY')).toBe('New York');
  });

  // DC is not in `datasets-us-states-abbr-names`, and neither are the
  // territories; the module patches DC in itself. Nothing else pins that, so a
  // patch dropped in a refactor would otherwise go unnoticed.
  test('names DC, which the dataset does not hold', () => {
    expect(licenseStateName('DC')).toBe('District of Columbia');
    expect(usStateNames.DC).toBe('District of Columbia');
  });

  // A plate read carries whichever region code the reader saw, so a Canadian
  // province or a federal fleet code arrives with no name to look up. The code
  // itself stands in, so a sentence reads "in ON" rather than stopping at
  // "in ".
  test('falls back to the code for a state the dataset has no name for', () => {
    expect(licenseStateName('ON')).toBe('ON');
  });
});
