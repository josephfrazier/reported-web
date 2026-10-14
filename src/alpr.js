import sharp from 'sharp';
import {
  alprCacheKey,
  readCachedReading,
  writeCachedReading,
} from './alprCache.js';

// Disable sharp's internal LRU cache so processed image data is released
// immediately instead of being held in memory across requests.
sharp.cache(false);

async function orientImageBuffer({ attachmentBuffer }) {
  console.time(`orientImageBuffer`); // eslint-disable-line no-console
  // eslint-disable-next-line no-console
  console.log(
    `image buffer length BEFORE sharp: ${attachmentBuffer.length} bytes`,
  );
  return (
    sharp(attachmentBuffer)
      .rotate()
      .toBuffer()
      .catch(() => attachmentBuffer)
      // sharp v0.35+ always returns a Buffer from toBuffer(), but older
      // versions had a bug where it could return a Uint8Array instead
      // (https://github.com/lovell/sharp/issues/1219). Guard against that
      // without doing an unnecessary copy in the common case.
      .then(buffer => (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)))
      .then(async buffer => {
        console.log(`image buffer length AFTER sharp: ${buffer.length} bytes`); // eslint-disable-line no-console
        console.timeEnd(`orientImageBuffer`); // eslint-disable-line no-console
        return buffer;
      })
  );
}

// https://app.platerecognizer.com/upload-limit/
const downscaleForPlateRecognizer = async ({ buffer, targetWidth }) => {
  const fileSize = buffer.length;
  const maxFilesize = 2411654;

  if (fileSize < maxFilesize) {
    return buffer;
  }

  // Video screenshots arrive as PNG, and a lossless PNG of a photo-like
  // frame is large enough to trip Plate Recognizer's upload limit even
  // after resizing (a 2048-wide one measured 13.8MB). Convert oversized
  // non-JPEG uploads to JPEG: the bytes are POSTed as image/jpeg either
  // way, and JPEG shrinks them below the limit. JPEGs are left alone here
  // -- re-encoding them would add a generation of loss the 2048 pass is
  // going to resize anyway.
  const toJpeg = () =>
    sharp(buffer)
      .jpeg()
      .toBuffer()
      .catch(error => {
        console.error('could not convert to JPEG, using unconverted image', {
          error,
        });
        return buffer;
      })
      // sharp v0.35+ always returns a Buffer from toBuffer(), but guard
      // against the old Uint8Array bug without an unnecessary copy.
      .then(jpegBuffer =>
        Buffer.isBuffer(jpegBuffer) ? jpegBuffer : Buffer.from(jpegBuffer),
      );

  // sharp's resize() enlarges by default, so a photo narrower than targetWidth
  // gets blown up here only for the next, smaller pass to shrink it again --
  // two resamples, a bigger intermediate buffer, and a generation of JPEG loss
  // to end up at the same size. Leave it for that pass to handle instead.
  const { width, format } = await sharp(buffer)
    .metadata()
    // A buffer sharp cannot read falls through to the resize below, which
    // already handles that by returning the image unscaled.
    .catch(() => ({}));

  if (width && width <= targetWidth && format === 'jpeg') {
    // eslint-disable-next-line no-console
    console.log(
      `image is only ${width}px wide, skipping scale down to width of ${targetWidth}`,
    );
    return buffer;
  }

  if (width && width <= targetWidth) {
    // eslint-disable-next-line no-console
    console.log(
      `image is only ${width}px wide, skipping scale down to width of ${targetWidth}, converting to JPEG instead`,
    );
    return toJpeg();
  }

  // eslint-disable-next-line no-console
  console.log(
    `file size is greater than maximum of ${maxFilesize} bytes, attempting to scale down to width of ${targetWidth}`,
  );

  return (
    sharp(buffer)
      .resize({ width: targetWidth })
      .jpeg()
      .toBuffer()
      .catch(error => {
        console.error('could not scale down, using unscaled image', { error });
        return buffer;
      })
      // sharp v0.35+ always returns a Buffer from toBuffer(), but guard
      // against the old Uint8Array bug without an unnecessary copy.
      .then(resizedBuffer => {
        const safe = Buffer.isBuffer(resizedBuffer)
          ? resizedBuffer
          : Buffer.from(resizedBuffer);
        // eslint-disable-next-line no-console
        console.log(`file size after scaling down: ${safe.length} bytes`);
        return safe;
      })
  );
};

// 30-second timeout for Plate Recognizer API calls to prevent hung requests
// from holding image buffers indefinitely
const PLATERECOGNIZER_TIMEOUT_MS = 30_000;

function platerecognizer({ attachmentBufferRotated, PLATERECOGNIZER_TOKEN }) {
  const blob = new Blob([attachmentBufferRotated], { type: 'image/jpeg' });
  const body = new FormData();
  body.append('upload', blob, 'image.jpg');

  // body.append("regions", "us-ny"); // Change to your country
  body.append('regions', 'us'); // Change to your country

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    PLATERECOGNIZER_TIMEOUT_MS,
  );

  return fetch('https://api.platerecognizer.com/v1/plate-reader/', {
    method: 'POST',
    headers: {
      Authorization: `Token ${PLATERECOGNIZER_TOKEN}`,
    },
    body,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

// How long each phase of a read took, in milliseconds, written into the object
// the caller passed in. A caller that passes none -- the tests -- records
// nothing.
function makeLapRecorder(timings) {
  let since = Date.now();

  return name => {
    const now = Date.now();
    // Filling the caller's object is the point of it: the numbers outlive this
    // read, and the route reads them back once the reading is returned.
    // eslint-disable-next-line no-param-reassign
    timings[name] = now - since;
    since = now;
  };
}

// The reading the cache could not answer: orient and resize the photo the way
// Plate Recognizer wants it, read it, cut the crops out, and store the reading
// under the key the caller looked up with.
function readFromPlateRecognizer({
  attachmentBuffer,
  PLATERECOGNIZER_TOKEN,
  PLATERECOGNIZER_TOKEN_TWO,
  cacheKey,
  lap,
}) {
  return orientImageBuffer({ attachmentBuffer })
    .then(buffer => {
      lap('orient');
      return downscaleForPlateRecognizer({ buffer, targetWidth: 4096 });
    })
    .then(buffer => {
      lap('downscale4096');
      return downscaleForPlateRecognizer({ buffer, targetWidth: 2048 });
    })
    .then(async attachmentBufferRotated => {
      lap('downscale2048');

      console.log('STARTING platerecognizer'); // eslint-disable-line no-console
      console.time(`/platerecognizer plate-reader`); // eslint-disable-line no-console

      const reading = await platerecognizer({
        attachmentBufferRotated,
        PLATERECOGNIZER_TOKEN,
      })
        .then(async platerecognizerRes => {
          if (platerecognizerRes.ok) {
            return platerecognizerRes;
          }

          // Consume the failed response body so the underlying socket is
          // released back to the pool rather than held until GC.
          await platerecognizerRes.body?.cancel().catch(() => {});

          console.info(
            '/platerecognizer plate-reader got an error with first token, trying second',
          );

          return platerecognizer({
            attachmentBufferRotated,
            PLATERECOGNIZER_TOKEN: PLATERECOGNIZER_TOKEN_TWO,
          });
        })
        .then(platerecognizerRes => {
          console.info('/platerecognizer plate-reader', {
            platerecognizerRes,
          });
          return platerecognizerRes;
        })
        .then(platerecognizerRes => {
          if (!platerecognizerRes.ok) {
            return platerecognizerRes.json().then(errData => {
              const err = new Error(
                `Plate Recognizer API error: ${platerecognizerRes.status} - ${JSON.stringify(errData)}`,
              );
              err.status = platerecognizerRes.status;
              throw err;
            });
          }
          return platerecognizerRes.json();
        })
        .then(async data => {
          // The answer is in hand, so a slow call is behind us; what is left
          // is sharp's work on the crops.
          lap('plateRecognizer');

          // Plate Recognizer resizes uploads before processing and reports the
          // resized size as image_width/image_height (e.g. a 2048x2731 upload
          // comes back as 1919x2560), but `box` coordinates stay in the pixel
          // space of the image we sent -- the same space cropBox() extracts
          // from below. Pass that size along so the client can place plate
          // overlays on the picture without guessing at the difference.
          const { width: uploadWidth, height: uploadHeight } = await sharp(
            attachmentBufferRotated,
          )
            .metadata()
            // orientImageBuffer() falls back to the unprocessed buffer when
            // sharp cannot read it; don't fail the whole request over sizing.
            .catch(() => ({}));

          async function cropBox(box) {
            if (!box) return null;
            const { xmin, ymin, xmax, ymax } = box;
            const width = xmax - xmin;
            const height = ymax - ymin;
            if (width <= 0 || height <= 0) return null;
            const cropBuffer = await sharp(attachmentBufferRotated)
              .extract({ left: xmin, top: ymin, width, height })
              .jpeg()
              .toBuffer();
            return `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
          }

          const resultsWithCrops = await Promise.all(
            data.results.map(async result => {
              const crops = {};
              try {
                crops.vehicleCropDataUrl = await cropBox(
                  result.vehicle && result.vehicle.box,
                );
                crops.plateCropDataUrl = await cropBox(result.box);
              } catch (err) {
                console.error('Failed to crop image:', err);
              }
              return { ...result, ...crops };
            }),
          );
          lap('crops');

          return {
            ...data,
            results: resultsWithCrops,
            uploadWidth,
            uploadHeight,
          };
        })
        .finally(() => console.timeEnd(`/platerecognizer plate-reader`)); // eslint-disable-line no-console

      await writeCachedReading(cacheKey, reading);
      lap('cacheWrite');

      return reading;
    });
}

export default function readLicenseViaALPR({
  attachmentBuffer,
  PLATERECOGNIZER_TOKEN,
  PLATERECOGNIZER_TOKEN_TWO,
  timings = {},
}) {
  // The phases below are what the route sends back with the reading, so the
  // browser can print where a read's time went. A photo added twice answers
  // from the cache with an identical reading, and these numbers are the
  // difference between a read that was fast and a read that was not done.
  const lap = makeLapRecorder(timings);

  // A reading is a function of the bytes the request carries, so the same
  // photo is the same answer -- and those bytes are the key, looked up before
  // any of the work below runs. Asking after the rotate and the resizes would
  // make a hit pay most of what the call itself costs, which is the wait this
  // cache exists to remove. Off unless ALPR_CACHE_DIR is set; the trade the
  // key makes is in alprCache.js.
  const cacheKey = alprCacheKey(attachmentBuffer);

  return readCachedReading(cacheKey).then(cached => {
    lap('cacheLookup');

    if (cached) {
      // Logged in place of the STARTING line below: that line counts the
      // calls that reach Plate Recognizer, and this one did not.
      console.info('/platerecognizer plate-reader answered from the cache');
      return cached;
    }

    return readFromPlateRecognizer({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN,
      PLATERECOGNIZER_TOKEN_TWO,
      cacheKey,
      lap,
    });
  });
}
