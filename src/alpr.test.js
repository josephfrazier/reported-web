/**
 * @jest-environment node
 */
/* eslint-env jest */

import { readFileSync } from 'fs';

import readLicenseViaALPR from './alpr.js';

describe('readLicenseViaALPR', () => {
  test('using only the first token', async () => {
    const attachmentBuffer = readFileSync(
      './src/4d81b7e083843d949a73cc1178227fe8_photoData0.jpg',
    );
    const { PLATERECOGNIZER_TOKEN } = process.env;

    const result = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN,
    });

    expect(result.results[0]).toMatchSnapshot();
  });

  test('falling back to the second token', async () => {
    const attachmentBuffer = readFileSync(
      './src/4d81b7e083843d949a73cc1178227fe8_photoData0.jpg',
    );
    const { PLATERECOGNIZER_TOKEN_TWO } = process.env;

    const result = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN: 'INVALID TOKEN',
      PLATERECOGNIZER_TOKEN_TWO,
    });

    expect(result.results[0]).toMatchSnapshot();
  });
});
