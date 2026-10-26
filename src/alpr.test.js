/**
 * @jest-environment node
 */

import { readFileSync } from 'fs';
import { hash } from 'crypto';

import readLicenseViaALPR from './alpr.js';

function makeHash(dataUrl) {
  const shasum = hash('sha256', dataUrl);
  return `THIS IS HASHED TO REDUCE LENGTH WHILE ASSURING INTEGRITY: ${shasum}`;
}

// These tests are the only ones that call Plate Recognizer. They need the
// service to answer, and the cache is off under test, so what they see is the
// service's own answer; see src/alprCache.js.

describe('readLicenseViaALPR', () => {
  test('using the first token in the list', async () => {
    const attachmentBuffer = readFileSync(
      './src/447139692-0ee99c9b-73a4-49fb-a610-389db5cbddd3_exif_stripped.jpg',
    );
    const { PLATERECOGNIZER_TOKEN_LIST } = process.env;

    const result = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN_LIST,
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

  test('falling back to the next token', async () => {
    const attachmentBuffer = readFileSync(
      './src/447139692-0ee99c9b-73a4-49fb-a610-389db5cbddd3_exif_stripped.jpg',
    );
    const { PLATERECOGNIZER_TOKEN_LIST } = process.env;

    // Plate Recognizer limits calls per token to one per second, and the test
    // above has just used the token this one falls back to. When the list has
    // no other usable token, the next call comes back 429 until the wait
    // passes.
    await new Promise(resolve => setTimeout(resolve, 1200));

    const result = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN_LIST: `INVALID TOKEN,${PLATERECOGNIZER_TOKEN_LIST}`,
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
