/**
 * @jest-environment node
 */
/* eslint-env jest */

import { processValidation } from './geoclient.js';

describe('processValidation', () => {
  test('returns the right object around 40.6435893,-73.7820064', async () => {
    const [lat, long] = [40.6435893, -73.7820064];
    const result = await processValidation({ lat, long });

    expect(result).toMatchSnapshot();
  });
});
