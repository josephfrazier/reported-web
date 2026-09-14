/**
 * @jest-environment node
 */

import { geosearch, selectCanonicalFeature } from './geoclient.js';

const feature = ({ name, bbl }) => ({
  properties: {
    name,
    addendum: { pad: { bbl } },
  },
});

describe('selectCanonicalFeature', () => {
  const getPadAddressForBbl = jest.fn(async () => '146 HOYT STREET');

  afterEach(() => {
    getPadAddressForBbl.mockClear();
    jest.restoreAllMocks();
  });

  test('prefers the feature matching the PAD address for its BBL', async () => {
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
      feature({ name: '146 HOYT STREET', bbl: '3001940042' }),
      feature({ name: '127 BERGEN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(features, getPadAddressForBbl);

    expect(getPadAddressForBbl).toHaveBeenCalledWith('3001940042');
    expect(result.properties.name).toBe('146 HOYT STREET');
  });

  test('returns the top result when no feature matches the PAD address', async () => {
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
      feature({ name: '131 BERGAN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(features, getPadAddressForBbl);

    expect(result.properties.name).toBe('127 BERGAN STREET');
  });

  test('returns the top result when the PAD lookup fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(features, async () => {
      throw new Error('PAD is down');
    });

    expect(result.properties.name).toBe('127 BERGAN STREET');
  });

  test('returns the top result when PAD has no address for the BBL', async () => {
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(
      features,
      async () => undefined,
    );

    expect(result.properties.name).toBe('127 BERGAN STREET');
  });

  test('returns the top result when it has no BBL', async () => {
    const features = [feature({ name: 'SOMEWHERE', bbl: undefined })];

    const result = await selectCanonicalFeature(features, getPadAddressForBbl);

    expect(getPadAddressForBbl).not.toHaveBeenCalled();
    expect(result.properties.name).toBe('SOMEWHERE');
  });

  test('returns undefined for empty results', async () => {
    const result = await selectCanonicalFeature([], getPadAddressForBbl);

    expect(result).toBeUndefined();
    expect(getPadAddressForBbl).not.toHaveBeenCalled();
  });
});

describe('geosearch', () => {
  test('returns 146 HOYT STREET for the point selected by searching 127 Bergen', async () => {
    const result = await geosearch({
      lat: 40.686051,
      long: -73.988426,
    });

    expect(result.features[0].properties.name).toBe('146 HOYT STREET');
  });

  test('returns the right object around the Empire State Building', async () => {
    const result = await geosearch({
      lat: 40.748817,
      long: -73.985428,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object', async () => {
    const result = await geosearch({
      lat: 40.7128,
      long: -74.006,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object for string lat/long', async () => {
    const result = await geosearch({
      lat: '40.7128',
      long: '-74.006',
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });

  test('returns the right object around 3521 Riverdale Ave, The Bronx, NY 10463', async () => {
    const result = await geosearch({
      lat: 40.88067222222222,
      long: -73.91039722222223,
    });

    result.geocoding.timestamp =
      'RESET BY SNAPSHOT TEST, WOULD BE A NUMBER LIKE `1785874040249`';

    expect(result).toMatchSnapshot();
  });
});
