/**
 * @jest-environment node
 */
/* eslint-env jest */

import { readFileSync } from 'fs';
import { hash } from 'crypto';

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

    const firstResult = result.results[0];
    firstResult.plateCropDataUrl = `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${hash(
      'sha256',
      firstResult.plateCropDataUrl,
    )}`;
    firstResult.vehicleCropDataUrl = `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${hash(
      'sha256',
      firstResult.vehicleCropDataUrl,
    )}`;

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
    firstResult.plateCropDataUrl = `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${hash(
      'sha256',
      firstResult.plateCropDataUrl,
    )}`;
    firstResult.vehicleCropDataUrl = `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${hash(
      'sha256',
      firstResult.vehicleCropDataUrl,
    )}`;

    expect(firstResult).toMatchSnapshot();
  }, 10000);
});
