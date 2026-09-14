/**
 * @jest-environment node
 *
 * Runs against the real temp-dir attachment store (see
 * src/attachmentStore.js), so the write/read/TTL behavior is the real one
 * instead of a fake.
 */

import getAttachmentData from './getAttachmentData.js';
import { attachmentId, writeAttachment } from './attachmentStore.js';

describe('getAttachmentData', () => {
  test('returns multer files untouched when no attachmentIds are given', async () => {
    const files = [{ buffer: Buffer.from('attachment bytes') }];

    await expect(
      getAttachmentData({ attachmentIdsJson: undefined, files }),
    ).resolves.toBe(files);
  });

  test('reads pre-uploaded attachment buffers back from the store', async () => {
    const buffer = Buffer.from('attachment bytes');
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
        attachmentIdsJson: JSON.stringify(['a'.repeat(64)]),
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
