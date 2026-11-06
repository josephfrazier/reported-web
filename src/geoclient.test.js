/**
 * @jest-environment node
 */

import axios from 'axios';

import {
  geosearch,
  getPadAddress,
  selectCanonicalFeature,
} from './geoclient.js';

const feature = ({ name, bbl, layer = 'venue' }) => ({
  properties: {
    name,
    addendum: { pad: { bbl } },
    layer,
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

  test('prefers the feature matching the selected search result over the PAD address', async () => {
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
      feature({ name: '146 HOYT STREET', bbl: '3001940042' }),
      feature({ name: '127 BERGEN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(
      features,
      getPadAddressForBbl,
      '127 Bergen St',
    );

    expect(getPadAddressForBbl).not.toHaveBeenCalled();
    expect(result.properties.name).toBe('127 BERGEN STREET');
  });

  test('uses the PAD address when the selected search result matches no feature', async () => {
    const features = [
      feature({ name: '127 BERGAN STREET', bbl: '3001940042' }),
      feature({ name: '146 HOYT STREET', bbl: '3001940042' }),
      feature({ name: '127 BERGEN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(
      features,
      getPadAddressForBbl,
      '999 Nowhere St',
    );

    expect(getPadAddressForBbl).toHaveBeenCalledWith('3001940042');
    expect(result.properties.name).toBe('146 HOYT STREET');
  });

  test('ignores features on non-address layers when matching the selected search result', async () => {
    const features = [
      feature({
        name: '127 BERGEN STREET',
        bbl: '3001940042',
        layer: 'locality',
      }),
      feature({ name: '127 BERGEN STREET', bbl: '3001940042' }),
    ];

    const result = await selectCanonicalFeature(
      features,
      getPadAddressForBbl,
      '127 Bergen St',
    );

    expect(getPadAddressForBbl).not.toHaveBeenCalled();
    expect(result.properties.layer).toBe('venue');
  });
});

describe('getPadAddress', () => {
  const serviceUnavailableError = () =>
    Object.assign(new Error('Service unavailable'), {
      response: { status: 503 },
    });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('retries when PAD returns 503', async () => {
    jest.useFakeTimers();
    const axiosGet = jest.spyOn(axios, 'get');
    axiosGet
      .mockRejectedValueOnce(serviceUnavailableError())
      .mockResolvedValueOnce({ data: [{ address: '123 MAIN STREET' }] });

    const promise = getPadAddress('9999999999');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBe('123 MAIN STREET');
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  test('gives up after three retries', async () => {
    jest.useFakeTimers();
    const axiosGet = jest.spyOn(axios, 'get');
    axiosGet.mockRejectedValue(serviceUnavailableError());

    const promise = getPadAddress('8888888888');
    promise.catch(() => {});
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(750);

    await expect(promise).rejects.toThrow('Service unavailable');
    expect(axiosGet).toHaveBeenCalledTimes(4);
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

  test('returns 127 BERGEN STREET when the selected address is 127 Bergen St', async () => {
    const result = await geosearch({
      lat: 40.686051,
      long: -73.988426,
      address: '127 Bergen St',
    });

    expect(result.features[0].properties.name).toBe('127 BERGEN STREET');
  });

  // The point on the NYU Tandon campus that inspired the BBL dedupe: the
  // top result for this point is D AND M OTHMER RESIDENCE HALL, and the
  // PAD's official address for its BBL is 101 TECH PLACE.
  test('returns 101 TECH PLACE for the point that inspired the BBL dedupe', async () => {
    const result = await geosearch({
      lat: 40.69488611111111,
      long: -73.986175,
    });

    expect(result.features[0].properties.name).toBe('101 TECH PLACE');
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
