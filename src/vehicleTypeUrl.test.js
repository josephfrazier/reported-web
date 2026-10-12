import vehicleTypeUrl from './vehicleTypeUrl.js';

describe('vehicleTypeUrl', () => {
  test('names the state in the URL', () => {
    expect(vehicleTypeUrl({ licensePlate: 'ABC123', licenseState: 'NY' })).toBe(
      'https://www.lookupaplate.com/new-york/ABC123/',
    );
  });

  // Regression test: the dataset holds the 50 states plus DC, so a plate from
  // anywhere else -- a Canadian province, a federal fleet code -- has no name
  // to look up, and building the URL threw on the undefined name. That broke
  // rendering the whole vehicle info line for such a plate.
  test('falls back to the code for a state the dataset has no name for', () => {
    expect(vehicleTypeUrl({ licensePlate: 'ABC123', licenseState: 'ON' })).toBe(
      'https://www.lookupaplate.com/on/ABC123/',
    );
  });
});
