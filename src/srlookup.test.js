/**
 * @jest-environment node
 */
/* eslint-env jest */

import srlookup from './srlookup.js';

describe('srlookup', () => {
  test('returns the right object', async () => {
    const result = await srlookup({ reqnumber: '311-00039062' });

    expect(result).toMatchSnapshot();
  });
});
