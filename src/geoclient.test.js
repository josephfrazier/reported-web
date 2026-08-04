/**
 * @jest-environment node
 */

import axios from 'axios';

import { geosearch } from './geoclient.js';

jest.mock('axios');

describe('geosearch', () => {
  test('calls the planning labs reverse endpoint', async () => {
    axios.get.mockResolvedValue({ data: { features: [] } });

    const result = await geosearch({
      lat: 40.748817,
      long: -73.985428,
    });

    expect(axios.get).toHaveBeenCalledWith(
      'https://geosearch.planninglabs.nyc/v2/reverse',
      {
        params: {
          'point.lat': 40.748817,
          'point.lon': -73.985428,
          size: 1,
        },
      },
    );
    expect(result).toEqual({ features: [] });
  });
});
