import fs from 'fs';
import {
  ATTACHMENT_TTL_MS,
  attachmentFilePath,
  readAttachment,
  writeAttachment,
} from './attachmentStore.js';

describe('attachmentStore', () => {
  const id = 'a'.repeat(64);
  const otherId = 'b'.repeat(64);

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
