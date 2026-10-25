import vehicleTypeUrl from './vehicleTypeUrl.js';

describe('vehicleTypeUrl', () => {
  test('names the state in the URL', () => {
    expect(vehicleTypeUrl({ licensePlate: 'ABC123', licenseState: 'NY' })).toBe(
      'https://www.lookupaplate.com/new-york/ABC123/',
    );
  });

  // The dataset holds the 50 states plus DC, and a plate can carry a state
  // that is not in it: ALPR reads the region code straight off the plate, so a
  // Canadian province or a federal fleet code arrives here too. Building the
  // URL then threw on the undefined name, which took down the whole vehicle
  // info line for such a plate.
  test('falls back to the code for a state the dataset has no name for', () => {
    expect(vehicleTypeUrl({ licensePlate: 'ABC123', licenseState: 'ON' })).toBe(
      'https://www.lookupaplate.com/on/ABC123/',
    );
  });
});
