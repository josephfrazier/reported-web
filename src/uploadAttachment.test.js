/**
 * @jest-environment node
 *
 * Files are written to the real temp-dir attachment store (see
 * src/attachmentStore.js). Authenticating the uploader is the /api/uploadAttachment
 * route's job now, and src/session.test.js covers that.
 */

import crypto from 'crypto';

import uploadAttachment from './uploadAttachment.js';
import { readAttachment } from './attachmentStore.js';

describe('uploadAttachment', () => {
  const buffer = Buffer.from('attachment bytes');

  test('stores the file under its SHA-256 hash and returns that id', async () => {
    const id = await uploadAttachment({ buffer });

    expect(id).toBe(crypto.createHash('sha256').update(buffer).digest('hex'));
    expect(await readAttachment(id)).toEqual(buffer);
  });
});
