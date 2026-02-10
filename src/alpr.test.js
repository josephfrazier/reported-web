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

    result.filename = 'filename REMOVED BECAUSE IT CHANGES';
    result.processing_time = 'processing_time REMOVED BECAUSE IT CHANGES';
    result.timestamp = 'timestamp REMOVED BECAUSE IT CHANGES';

    result.results.forEach(res => {
      res.plateCropDataUrl = makeHash(res.plateCropDataUrl);
      res.vehicleCropDataUrl = makeHash(res.vehicleCropDataUrl);
    });

    expect(result).toMatchSnapshot();
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

    result.filename = 'filename REMOVED BECAUSE IT CHANGES';
    result.processing_time = 'processing_time REMOVED BECAUSE IT CHANGES';
    result.timestamp = 'timestamp REMOVED BECAUSE IT CHANGES';

    result.results.forEach(res => {
      res.plateCropDataUrl = makeHash(res.plateCropDataUrl);
      res.vehicleCropDataUrl = makeHash(res.vehicleCropDataUrl);
    });

    expect(result).toMatchSnapshot();
  }, 10000);
});
