// A small copy of a photo, as a data URL, for the tile the form draws it in.
//
// The tiles are a few hundred pixels wide, but an <img> makes the browser
// decode the whole picture: a 12-megapixel phone photo takes about 48 MB of
// memory once decoded, and the form holds several at a time. A preview has a
// long edge of at most PREVIEW_MAX_EDGE pixels, so the browser decodes a
// fraction of that.
//
// A data URL rather than an object URL: the string is collected with the photo
// it belongs to, where an object URL has to be revoked, and one that is not
// holds the picture in memory for the life of the page.
export const PREVIEW_MAX_EDGE = 1600;

// The preview of `file`, or null when there is nothing to gain from one: the
// photo is already small, the browser cannot decode it here, or there is no
// canvas to draw one on (the test environment has none).
export default async function photoPreview(file) {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Not an image the browser can decode; the caller draws the file itself.
    return null;
  }

  try {
    const largestEdge = Math.max(bitmap.width, bitmap.height);
    if (!largestEdge || largestEdge <= PREVIEW_MAX_EDGE) {
      return null;
    }

    const scale = PREVIEW_MAX_EDGE / largestEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    bitmap.close?.();
  }
}
