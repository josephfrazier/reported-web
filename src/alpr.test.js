/**
 * @jest-environment node
 */
/* eslint-env jest */

import { readFileSync } from 'fs';
import { hash } from 'crypto';

import readLicenseViaALPR from './alpr.js';

function makeHash(dataUrl) {
  const shasum = hash('sha256', dataUrl);
  return `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${shasum}`;
}

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

    const firstResult = result.results[0];
    firstResult.plateCropDataUrl = makeHash(firstResult.plateCropDataUrl);
    firstResult.vehicleCropDataUrl = makeHash(firstResult.vehicleCropDataUrl);

    expect(firstResult).toMatchSnapshot();
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

    const firstResult = result.results[0];
    firstResult.plateCropDataUrl = makeHash(firstResult.plateCropDataUrl);
    firstResult.vehicleCropDataUrl = makeHash(firstResult.vehicleCropDataUrl);

    expect(firstResult).toMatchSnapshot();
  }, 10000);
});
