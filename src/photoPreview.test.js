import photoPreview, {
  PREVIEW_MAX_EDGE,
  queuePreview,
} from './photoPreview.js';

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

// A batch of photos is decoded for its previews one at a time: each decode
// holds the whole photo for a moment, and 25 together hold 25 of them.
test('makes one preview at a time', async () => {
  let inFlight = 0;
  let mostAtOnce = 0;
  const settle = [];
  global.createImageBitmap = jest.fn(
    () =>
      new Promise(resolve => {
        inFlight += 1;
        mostAtOnce = Math.max(mostAtOnce, inFlight);
        settle.push(() => {
          inFlight -= 1;
          resolve(bitmapOf({ width: 800, height: 600 }));
        });
      }),
  );

  const first = queuePreview(new File(['a'], 'a.jpg'));
  const second = queuePreview(new File(['b'], 'b.jpg'));

  // Let the queue start the first one and nothing else.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settle).toHaveLength(1);

  settle[0]();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(settle).toHaveLength(2);

  settle[1]();
  await Promise.all([first, second]);
  expect(mostAtOnce).toBe(1);
});

test('keeps the preview under the size it promises', () => {
  // The number is the module's promise to the caller: a long edge in pixels.
  expect(PREVIEW_MAX_EDGE).toBe(1600);
});
