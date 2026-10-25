import { strToU8, zipSync } from 'fflate';
import * as blobUtil from 'blob-util';
import { expandZipFiles, isZip } from './zipAttachments.js';

// Just enough of a JPEG for the type to be read from the name, which is all
// this module looks at.
const jpegBytes = label =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...strToU8(label)]);
const mp4Bytes = label =>
  Uint8Array.from([0x00, 0x00, 0x00, 0x18, ...strToU8(label)]);

const zipFile = ({ name = 'photos.zip', entries, type = 'application/zip' }) =>
  new File([zipSync(entries)], name, { type });

describe('isZip', () => {
  test('is true for a zip by type and by name', () => {
    expect(isZip(new File(['x'], 'archive', { type: 'application/zip' }))).toBe(
      true,
    );
    // A phone's share sheet often sends the name and no type.
    expect(isZip(new File(['x'], 'photos.zip', { type: '' }))).toBe(true);
    expect(
      isZip(
        new File(['x'], 'photos.zip', { type: 'application/x-zip-compressed' }),
      ),
    ).toBe(true);
  });

  test('is false for the photos themselves', () => {
    expect(isZip(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(
      false,
    );
    expect(isZip(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe(
      false,
    );
  });
});

describe('expandZipFiles', () => {
  test('opens a zip into the photos and videos it holds', async () => {
    const { files, zips } = await expandZipFiles([
      zipFile({
        entries: {
          'IMG_0001.jpg': jpegBytes('one'),
          'IMG_0002.jpg': jpegBytes('two'),
          'clip.mp4': mp4Bytes('clip'),
        },
      }),
    ]);

    expect(files.map(file => file.name)).toEqual([
      'IMG_0001.jpg',
      'IMG_0002.jpg',
      'clip.mp4',
    ]);
    expect(files.map(file => file.type)).toEqual([
      'image/jpeg',
      'image/jpeg',
      'video/mp4',
    ]);
    expect(zips).toEqual([
      { name: 'photos.zip', attachments: [files[0], files[1], files[2]] },
    ]);

    // The bytes are the entry's own. Read through blob-util, which is what the
    // module reads a File with: the test environment's File has neither
    // `text()` nor `arrayBuffer()`.
    const bytes = new Uint8Array(await blobUtil.blobToArrayBuffer(files[0]));
    expect(Buffer.from(bytes).toString()).toContain('one');
  });

  test('leaves everything that is not a zip exactly as it is', async () => {
    const photo = new File([jpegBytes('loose')], 'loose.jpg', {
      type: 'image/jpeg',
    });

    const { files, zips } = await expandZipFiles([photo]);

    expect(files).toEqual([photo]);
    // The same File, not a copy: what the picker handed over is what the batch
    // gets.
    expect(files[0]).toBe(photo);
    expect(zips).toEqual([]);
  });

  test('drops the folder a whole archive was zipped from', async () => {
    const { files } = await expandZipFiles([
      zipFile({
        entries: {
          'photos/IMG_0001.jpg': jpegBytes('one'),
          'photos/IMG_0002.jpg': jpegBytes('two'),
        },
      }),
    ]);

    expect(files.map(file => file.name)).toEqual([
      'IMG_0001.jpg',
      'IMG_0002.jpg',
    ]);
  });

  test('keeps the path when two folders hold the same name', async () => {
    const { files } = await expandZipFiles([
      zipFile({
        entries: {
          'monday/IMG_0001.jpg': jpegBytes('monday'),
          'tuesday/IMG_0001.jpg': jpegBytes('tuesday'),
        },
      }),
    ]);

    // The form tells photos apart by name, so two of the same name have to
    // keep what tells them apart.
    expect(files.map(file => file.name)).toEqual([
      'monday/IMG_0001.jpg',
      'tuesday/IMG_0001.jpg',
    ]);
  });

  test('skips what is not an attachment, and the metadata macOS adds', async () => {
    const { files } = await expandZipFiles([
      zipFile({
        entries: {
          'photos/': new Uint8Array(0),
          'photos/IMG_0001.jpg': jpegBytes('one'),
          'photos/README.txt': strToU8('not a photo'),
          '__MACOSX/._IMG_0001.jpg': jpegBytes('resource fork'),
          '.DS_Store': strToU8('junk'),
        },
      }),
    ]);

    expect(files.map(file => file.name)).toEqual(['IMG_0001.jpg']);
  });

  test('says when a zip held nothing it could use', async () => {
    const { files, zips } = await expandZipFiles([
      zipFile({ entries: { 'notes.txt': strToU8('nothing here') } }),
    ]);

    expect(files).toEqual([]);
    expect(zips).toEqual([{ name: 'photos.zip', attachments: [] }]);
  });

  test('says when a zip could not be read at all', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const broken = new File(['not a zip at all'], 'broken.zip', {
      type: 'application/zip',
    });
    const photo = new File([jpegBytes('loose')], 'loose.jpg', {
      type: 'image/jpeg',
    });

    const { files, zips } = await expandZipFiles([broken, photo]);

    // The rest of the pick still arrives.
    expect(files).toEqual([photo]);
    expect(zips).toEqual([
      { name: 'broken.zip', attachments: [], failed: true },
    ]);

    consoleError.mockRestore();
  });
});
