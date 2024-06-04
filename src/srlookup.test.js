/**
 * @jest-environment node
 */
/* eslint-env jest */

import srlookup from './srlookup.js';

describe('srlookup', () => {
  test('returns the right object', async () => {
    const result = await srlookup({ reqnumber: '311-18685922' });

    expect(result).toMatchSnapshot();
  });
});
