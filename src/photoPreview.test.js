import photoPreview, { PREVIEW_MAX_EDGE } from './photoPreview.js';

const originalCreateImageBitmap = global.createImageBitmap;

afterEach(() => {
  if (originalCreateImageBitmap === undefined) {
    delete global.createImageBitmap;
  } else {
    global.createImageBitmap = originalCreateImageBitmap;
  }
});

const bitmapOf = ({ width, height }) => ({
  width,
  height,
  close: jest.fn(),
});

test('answers nothing for a photo that is already small', async () => {
  const bitmap = bitmapOf({ width: 800, height: 600 });
  global.createImageBitmap = jest.fn().mockResolvedValue(bitmap);

  expect(await photoPreview(new File(['photo'], 'photo.jpg'))).toBeNull();
  // The bitmap is the browser's; it goes whatever the answer.
  expect(bitmap.close).toHaveBeenCalled();
});

test('answers nothing for a photo the browser cannot decode', async () => {
  global.createImageBitmap = jest
    .fn()
    .mockRejectedValue(new Error('not an image'));

  expect(await photoPreview(new File(['x'], 'photo.jpg'))).toBeNull();
});

test('answers nothing where there is no canvas to draw on', async () => {
  global.createImageBitmap = jest
    .fn()
    .mockResolvedValue(bitmapOf({ width: 4000, height: 3000 }));

  // The test environment's canvas has no 2d context, which is the same answer
  // a browser without one would give.
  expect(await photoPreview(new File(['photo'], 'photo.jpg'))).toBeNull();
});

test('answers nothing where the browser cannot decode at all', async () => {
  delete global.createImageBitmap;

  expect(await photoPreview(new File(['photo'], 'photo.jpg'))).toBeNull();
});

test('keeps the preview under the size it promises', () => {
  // The number is the module's promise to the caller: a long edge in pixels.
  expect(PREVIEW_MAX_EDGE).toBe(1600);
});
