import crypto from 'crypto';

import {
  ATTACHMENT_BUDGET_BYTES,
  canAfford,
  forgetUpload,
  outstandingBytes,
  recordUpload,
  releaseUploads,
} from './attachmentBudget.js';
import {
  ATTACHMENT_TTL_MS,
  deleteAttachment,
  readAttachment,
  writeAttachment,
} from './attachmentStore.js';

describe('attachmentBudget', () => {
  // The bookkeeping is process-wide, the way it is in the server, and a file is
  // kept while any client still holds it. So no two tests share an id: one
  // test's client would otherwise keep another test's file alive. The ids also
  // stay within this file, for the reason in attachmentStore.test.js: the store
  // keeps one file per id in the shared temp directory, so the cleanup below
  // would otherwise delete another file's attachment mid-test.
  const id = character =>
    crypto
      .createHash('sha256')
      .update(`attachmentBudget:${character}`)
      .digest('hex');
  const usedIds = ['a', 'b', 'c', 'd', 'e', 'f', '1', '2', '7', '8'].map(id);

  afterEach(async () => {
    await Promise.all(usedIds.map(usedId => deleteAttachment(usedId)));
  });

  test('adds up what one client is holding', () => {
    const ip = '10.0.0.1';

    expect(outstandingBytes(ip)).toBe(0);

    recordUpload({ ip, id: id('a'), bytes: 1000 });
    recordUpload({ ip, id: id('b'), bytes: 2500 });

    expect(outstandingBytes(ip)).toBe(3500);
    // Another client's uploads are its own.
    expect(outstandingBytes('10.0.0.2')).toBe(0);
  });

  test('does not charge twice for bytes it already holds', () => {
    const ip = '10.0.0.3';

    recordUpload({ ip, id: id('c'), bytes: 1000 });
    recordUpload({ ip, id: id('c'), bytes: 1000 });

    // The store is addressed by content, so the second upload wrote no second
    // copy of those bytes and costs nothing more.
    expect(outstandingBytes(ip)).toBe(1000);
  });

  test('affords an upload that exactly fills the budget, and not the byte after', () => {
    const ip = '10.0.0.4';

    expect(canAfford({ ip, bytes: ATTACHMENT_BUDGET_BYTES })).toBe(true);

    recordUpload({ ip, id: id('d'), bytes: ATTACHMENT_BUDGET_BYTES - 1 });

    expect(canAfford({ ip, bytes: 1 })).toBe(true);
    expect(canAfford({ ip, bytes: 2 })).toBe(false);
  });

  test('releases the uploads a submission used, and removes their files', async () => {
    const ip = '10.0.0.5';

    await writeAttachment(id('e'), Buffer.from('first'));
    await writeAttachment(id('f'), Buffer.from('second'));
    recordUpload({ ip, id: id('e'), bytes: 5 });
    recordUpload({ ip, id: id('f'), bytes: 6 });

    await releaseUploads({
      ip,
      attachmentIdsJson: JSON.stringify([id('e')]),
    });

    expect(outstandingBytes(ip)).toBe(6);
    expect(await readAttachment(id('e'))).toBeNull();
    // What the submission did not use is left alone.
    expect(await readAttachment(id('f'))).toEqual(Buffer.from('second'));
  });

  test('keeps a file another client is still holding', async () => {
    const uploader = '10.0.0.6';
    const other = '10.0.0.7';

    await writeAttachment(id('1'), Buffer.from('shared bytes'));
    recordUpload({ ip: uploader, id: id('1'), bytes: 12 });
    recordUpload({ ip: other, id: id('1'), bytes: 12 });

    // Identical bytes are one file between them, so the first to submit must
    // not take it away from the second.
    await releaseUploads({
      ip: uploader,
      attachmentIdsJson: JSON.stringify([id('1')]),
    });

    expect(outstandingBytes(uploader)).toBe(0);
    expect(outstandingBytes(other)).toBe(12);
    expect(await readAttachment(id('1'))).toEqual(Buffer.from('shared bytes'));

    // Once the second has submitted too, the file is nobody's.
    await releaseUploads({
      ip: other,
      attachmentIdsJson: JSON.stringify([id('1')]),
    });

    expect(await readAttachment(id('1'))).toBeNull();
  });

  test('gives back a reservation that came to nothing', async () => {
    const ip = '10.0.0.10';

    await writeAttachment(id('2'), Buffer.from('another client wrote this'));
    recordUpload({ ip, id: id('2'), bytes: 999 });

    forgetUpload({ ip, id: id('2') });

    expect(outstandingBytes(ip)).toBe(0);
    // Forgetting is not deleting: the file was not this client's to remove.
    expect(await readAttachment(id('2'))).toEqual(
      Buffer.from('another client wrote this'),
    );
  });

  test('has nothing to release when the submission named no uploads', async () => {
    await expect(
      releaseUploads({ ip: '10.0.0.8', attachmentIdsJson: undefined }),
    ).resolves.toBeUndefined();
    await expect(
      releaseUploads({ ip: '10.0.0.8', attachmentIdsJson: '[not json' }),
    ).resolves.toBeUndefined();
  });

  test('forgets an upload once its file would have expired', () => {
    const ip = '10.0.0.9';

    jest.useFakeTimers();
    try {
      recordUpload({ ip, id: id('7'), bytes: 1000 });
      expect(outstandingBytes(ip)).toBe(1000);

      jest.advanceTimersByTime(ATTACHMENT_TTL_MS + 1);

      // The file is gone by now, so it cannot still be holding budget.
      expect(outstandingBytes(ip)).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
