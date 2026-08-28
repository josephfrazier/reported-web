/**
 * @jest-environment node
 */

import { readFileSync } from 'fs';
import sharp from 'sharp';

import readLicenseViaALPR from './alpr.js';

// 3024x4032, and at 5.4MB large enough that it has to be scaled down before
// upload. Being narrower than the first pass's 4096 target is the point: that
// pass has nothing to do, and resizing to it would only enlarge the photo.
const photoPath =
  './src/447139692-0ee99c9b-73a4-49fb-a610-389db5cbddd3_exif_stripped.jpg';

// Runs the real pipeline with the network stubbed out, and reports what would
// have been POSTed to Plate Recognizer along with what was logged on the way.
async function captureUpload({ attachmentBuffer }) {
  const logs = [];
  const logSpy = jest.spyOn(console, 'log').mockImplementation(message => {
    logs.push(String(message));
  });
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (url, { body }) => ({
      ok: true,
      json: async () => ({
        results: [],
        image_width: 1919,
        image_height: 2560,
        uploaded: Buffer.from(await body.get('upload').arrayBuffer()),
      }),
    }));

  try {
    const data = await readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN: 'token-under-test',
    });
    return { uploaded: data.uploaded, logs, data };
  } finally {
    fetchSpy.mockRestore();
    logSpy.mockRestore();
  }
}

describe('downscaleForPlateRecognizer', () => {
  test('scales an oversized photo down without enlarging it first', async () => {
    const attachmentBuffer = readFileSync(photoPath);
    expect((await sharp(attachmentBuffer).metadata()).width).toBe(3024);

    const { uploaded, logs, data } = await captureUpload({ attachmentBuffer });

    // The photo is already narrower than 4096, so that pass is a no-op and
    // resizing to it would inflate the buffer for the 2048 pass to undo.
    expect(logs).toContainEqual(
      expect.stringContaining('skipping scale down to width of 4096'),
    );
    expect(logs).not.toContainEqual(
      expect.stringContaining('attempting to scale down to width of 4096'),
    );

    // Skipping that pass must not change what Plate Recognizer receives.
    const { width, height } = await sharp(uploaded).metadata();
    expect({ width, height }).toEqual({ width: 2048, height: 2731 });
    expect(uploaded.length).toBeLessThan(2411654);

    // ...and that size is what the client positions plate overlays against.
    expect(data.uploadWidth).toBe(2048);
    expect(data.uploadHeight).toBe(2731);
  }, 15000);
});
