/**
 * @jest-environment node
 *
 * Runs against the real temp-dir attachment store (see
 * src/attachmentStore.js), so the write/read/TTL behavior is the real one
 * instead of a fake.
 */

import crypto from 'crypto';

import getAttachmentData from './getAttachmentData.js';
import { attachmentId, writeAttachment } from './attachmentStore.js';

describe('getAttachmentData', () => {
  // The store files an attachment under the hash of its bytes, and jest runs
  // test files in parallel against one shared temp directory, so these bytes
  // and ids stay unique to this file: the same bytes elsewhere would be one
  // file, which another file's cleanup deletes mid-test.
  const buffer = Buffer.from('getAttachmentData attachment bytes');
  const missingId = crypto
    .createHash('sha256')
    .update('getAttachmentData: never written')
    .digest('hex');

  test('returns multer files untouched when no attachmentIds are given', async () => {
    const files = [{ buffer }];

    await expect(
      getAttachmentData({ attachmentIdsJson: undefined, files }),
    ).resolves.toBe(files);
  });

  test('reads pre-uploaded attachment buffers back from the store', async () => {
    const id = attachmentId(buffer);
    await writeAttachment(id, buffer);

    await expect(
      getAttachmentData({ attachmentIdsJson: JSON.stringify([id]) }),
    ).resolves.toEqual([{ buffer }]);
  });

  test('rejects attachmentIds whose entries are not strings', async () => {
    await expect(
      getAttachmentData({ attachmentIdsJson: JSON.stringify([123]) }),
    ).rejects.toMatchObject({
      message: 'Invalid attachmentIds format',
    });
  });

  test('rejects attachment ids that are not in the store', async () => {
    await expect(
      getAttachmentData({
        attachmentIdsJson: JSON.stringify([missingId]),
      }),
    ).rejects.toMatchObject({
      message: 'Attachment not found; please re-add your files and try again',
    });
  });

  test('rejects malformed attachmentIds JSON with the raw SyntaxError', async () => {
    // Without the HTTP layer's json-stringify-safe round-trip, the parse
    // error stays intact here (over HTTP it arrived as an empty error
    // object, as the characterization test pinned).
    await expect(
      getAttachmentData({ attachmentIdsJson: '[not json' }),
    ).rejects.toThrow(SyntaxError);
  });
});
