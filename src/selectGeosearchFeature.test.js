/**
 * @jest-environment node
 */

import selectGeosearchFeature from './selectGeosearchFeature.js';

const feature = ({ housenumber, street, borough = 'Brooklyn' }) => ({
  properties: { housenumber, street, borough },
});

describe('selectGeosearchFeature', () => {
  test('prefers a feature with a housenumber over a leading venue', () => {
    const features = [
      feature({ street: '72 PRECINCT STATIONHOUSE' }),
      feature({ housenumber: '834', street: 'FOURTH AVENUE' }),
      feature({ housenumber: '160', street: '29 STREET' }),
    ];

    expect(selectGeosearchFeature(features).properties.street).toBe(
      'FOURTH AVENUE',
    );
  });

  test('returns the top result when no feature has a housenumber', () => {
    const features = [
      feature({ street: '72 PRECINCT STATIONHOUSE' }),
      feature({ street: 'NYPD PRECINCT 72' }),
    ];

    expect(selectGeosearchFeature(features).properties.street).toBe(
      '72 PRECINCT STATIONHOUSE',
    );
  });

  test('ignores an empty-string housenumber', () => {
    const features = [
      feature({ housenumber: '', street: '72 PRECINCT STATIONHOUSE' }),
      feature({ housenumber: '834', street: 'FOURTH AVENUE' }),
    ];

    expect(selectGeosearchFeature(features).properties.street).toBe(
      'FOURTH AVENUE',
    );
  });

  test('returns undefined for an empty result list', () => {
    expect(selectGeosearchFeature([])).toBeUndefined();
  });
});
