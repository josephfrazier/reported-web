/**
 * @jest-environment node
 */
/* eslint-env jest */

import { readFileSync } from 'fs';

import omit from 'object.omit';

import readLicenseViaALPR from './alpr.js';

describe('readLicenseViaALPR', () => {
  test('returns the right object', async () => {
    const attachmentBuffer = readFileSync(
      './src/4d81b7e083843d949a73cc1178227fe8_photoData0.jpg',
    );
    const { PLATERECOGNIZER_TOKEN } = process.env;

    const result = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN,
    });

    expect(
      omit(result, ['filename', 'processing_time', 'timestamp']),
    ).toMatchSnapshot();
  });
});
