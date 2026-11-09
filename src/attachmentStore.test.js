import crypto from 'crypto';
import fs from 'fs';
import {
  ATTACHMENT_TTL_MS,
  attachmentFilePath,
  attachmentId,
  readAttachment,
  writeAttachment,
} from './attachmentStore.js';

describe('attachmentStore', () => {
  // The store keeps one file per id in the shared temp directory, and jest
  // runs test files in parallel, so an id that two files both use is one
  // file: the other file's cleanup deletes this file's attachment mid-test.
  // Deriving the ids from this file's name keeps them to this file.
  const idFor = name =>
    crypto.createHash('sha256').update(`attachmentStore:${name}`).digest('hex');
  const id = idFor('written');
  const otherId = idFor('never written');

  afterEach(async () => {
    await fs.promises
      .rm(attachmentFilePath(id), { force: true })
      .catch(() => {});
    await fs.promises
      .rm(attachmentFilePath(otherId), { force: true })
      .catch(() => {});
  });

  test('writes an attachment and reads it back', async () => {
    const buffer = Buffer.from('photo bytes');

    await writeAttachment(id, buffer);

    expect(await readAttachment(id)).toEqual(buffer);
  });

  test('returns null for an attachment that was never written', async () => {
    expect(await readAttachment(otherId)).toBeNull();
  });

  test('rejects invalid attachment ids', () => {
    expect(() => attachmentFilePath('../etc/passwd')).toThrow(
      'Invalid attachment id',
    );
    expect(() => attachmentFilePath(id.slice(0, -1))).toThrow(
      'Invalid attachment id',
    );
  });

  test('names attachments by the SHA-256 hash of their bytes', () => {
    const buffer = Buffer.from('photo bytes');

    expect(attachmentId(buffer)).toBe(
      crypto.createHash('sha256').update(buffer).digest('hex'),
    );
    // ...and the id is in the form the file-path validation accepts.
    expect(() => attachmentFilePath(attachmentId(buffer))).not.toThrow();
  });

  test('deletes attachments once the TTL has elapsed', async () => {
    jest.useFakeTimers();
    try {
      await writeAttachment(id, Buffer.from('photo bytes'));
      expect(fs.existsSync(attachmentFilePath(id))).toBe(true);

      // Firing the timer starts the unlink; restore real timers so the
      // filesystem operation's completion can be awaited.
      jest.advanceTimersByTime(ATTACHMENT_TTL_MS);
      jest.useRealTimers();
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(await readAttachment(id)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
