import { unzipSync } from 'fflate';
import * as blobUtil from 'blob-util';
import fileExtension from 'file-extension';
import { isImage, isVideo } from './isImage.js';

// The zip types a phone or a desktop produces, plus the extension, because a
// `.zip` from a share sheet often arrives with no type at all.
const ZIP_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'multipart/x-zip',
];

export const isZip = attachmentFile =>
  ZIP_TYPES.includes(attachmentFile.type) ||
  fileExtension(attachmentFile.name) === 'zip';

// Names a zip carries that are not attachments: the directory entries
// themselves, and the metadata macOS writes into every archive it makes.
const isNoise = name =>
  name.endsWith('/') ||
  name.startsWith('__MACOSX/') ||
  name.split('/').pop() === '.DS_Store';

// What a photo or video inside a zip should be called once it is out.
//
// An archive made by zipping a folder carries that folder's name on every
// entry ("photos/IMG_0001.jpg"), and the form uses a photo's name to tell one
// from another -- the queue, the picker and the plate data all key on it. The
// shared folder is dropped, since it says nothing about the photo; a name that
// still has a path in it (two folders of the same archive) keeps it, so that
// two IMG_0001.jpg stay apart.
const nameForEntry = ({ name, root }) =>
  root && name.startsWith(`${root}/`) ? name.slice(root.length + 1) : name;

// The one directory every entry sits in, if there is one.
const sharedRootOf = names => {
  const [first] = names;
  if (!first || !first.includes('/')) {
    return null;
  }

  const root = first.slice(0, first.indexOf('/'));
  return names.every(name => name.startsWith(`${root}/`)) ? root : null;
};

// A zip's entries as Files, ready to be treated like any other attachment.
async function attachmentsInZip(attachmentFile) {
  // Through blob-util, as the rest of the app reads a picked file: every
  // browser this runs in has `Blob.arrayBuffer`, but the test environment's
  // File does not, and one way of reading a File is better than two.
  const bytes = new Uint8Array(
    await blobUtil.blobToArrayBuffer(attachmentFile),
  );

  let entries;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    console.error(`could not read ${attachmentFile.name}:`, err);
    throw new Error(`could not read ${attachmentFile.name}`);
  }

  const names = Object.keys(entries).filter(name => !isNoise(name));
  const root = sharedRootOf(names);

  return names
    .filter(name => {
      const ext = fileExtension(name);
      return isImage({ ext }) || isVideo({ ext });
    })
    .map(name => {
      const entryName = nameForEntry({ name, root });
      return new File([entries[name]], entryName, {
        type: isVideo({ ext: fileExtension(entryName) })
          ? 'video/mp4'
          : 'image/jpeg',
      });
    });
}

// What was picked, with any zip in it opened out into the attachments it
// holds.
//
// A zip is what a folder of photos arrives as when it comes off a phone or a
// share sheet, so it is a way of picking a batch rather than a file the batch
// could use. Everything that is not a zip is passed through untouched, in the
// order it was picked; a zip's contents take its place.
export async function expandZipFiles(files) {
  const expanded = [];
  const zips = [];

  for (const attachmentFile of files) {
    if (!isZip(attachmentFile)) {
      expanded.push(attachmentFile);
    } else {
      let attachments = [];
      let failed = false;

      try {
        // eslint-disable-next-line no-await-in-loop -- the picks are the order, and an archive is read once.
        attachments = await attachmentsInZip(attachmentFile);
      } catch {
        failed = true;
      }

      zips.push(
        failed
          ? { name: attachmentFile.name, attachments, failed }
          : { name: attachmentFile.name, attachments },
      );
      expanded.push(...attachments);
    }
  }

  return { files: expanded, zips };
}
