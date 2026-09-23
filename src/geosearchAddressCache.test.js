import createGeosearchAddressCache from './geosearchAddressCache.js';

describe('geosearchAddressCache', () => {
  test('misses for coordinates that were never looked up', () => {
    const cache = createGeosearchAddressCache();

    expect(cache.get({ latitude: 40.7129, longitude: -74.0061 })).toBe(
      undefined,
    );
  });

  test('returns the address it was given for the coordinates it was given it for', () => {
    const cache = createGeosearchAddressCache();

    cache.set({
      latitude: 40.7129,
      longitude: -74.0061,
      address: '123 Main St, Manhattan',
    });

    expect(cache.get({ latitude: 40.7129, longitude: -74.0061 })).toBe(
      '123 Main St, Manhattan',
    );
  });

  test('keeps neighbouring coordinates apart', () => {
    const cache = createGeosearchAddressCache();

    cache.set({
      latitude: 40.7128,
      longitude: -74.0061,
      address: '123 Main St, Manhattan',
    });

    // A different latitude with a longitude that ends in the same digits: a key
    // that dropped the separator could bring these two together.
    expect(cache.get({ latitude: 40.71281, longitude: -74.006 })).toBe(
      undefined,
    );
  });

  test('treats a cached empty address as a hit, not a miss', () => {
    const cache = createGeosearchAddressCache();

    // Geosearch resolves coordinates with no street address (mid-block, a
    // park) to an empty address. That is an answer, and re-asking for it on
    // every violation at those coordinates would put back the traffic the
    // memo exists to remove.
    cache.set({ latitude: 40.7129, longitude: -74.0061, address: '' });

    expect(cache.get({ latitude: 40.7129, longitude: -74.0061 })).toBe('');
    expect(cache.get({ latitude: 40.7129, longitude: -74.0061 })).not.toBe(
      undefined,
    );
  });

  test('keys on the coordinate value, not on how it was spelled', () => {
    const cache = createGeosearchAddressCache();

    cache.set({
      latitude: 40.7129,
      longitude: -74.0061,
      address: '123 Main St, Manhattan',
    });

    expect(cache.get({ latitude: '40.7129', longitude: '-74.0061' })).toBe(
      '123 Main St, Manhattan',
    );
  });

  test('replaces an address when the same coordinates are set again', () => {
    const cache = createGeosearchAddressCache();

    cache.set({ latitude: 40.7129, longitude: -74.0061, address: 'First St' });
    cache.set({ latitude: 40.7129, longitude: -74.0061, address: 'Second St' });

    expect(cache.get({ latitude: 40.7129, longitude: -74.0061 })).toBe(
      'Second St',
    );
  });

  test('gives each cache its own addresses', () => {
    const serverCache = createGeosearchAddressCache();
    const nextRequestCache = createGeosearchAddressCache();

    serverCache.set({
      latitude: 40.7129,
      longitude: -74.0061,
      address: '123 Main St, Manhattan',
    });

    expect(
      nextRequestCache.get({ latitude: 40.7129, longitude: -74.0061 }),
    ).toBe(undefined);
  });
});
