import sharp from 'sharp';
import nodeFetch from 'node-fetch';
import FormData from 'form-data';

async function orientImageBuffer({ attachmentBuffer }) {
  console.time(`orientImageBuffer`); // eslint-disable-line no-console
  // eslint-disable-next-line no-console
  console.log(
    `image buffer length BEFORE sharp: ${attachmentBuffer.length} bytes`,
  );
  return sharp(attachmentBuffer)
    .rotate()
    .toBuffer()
    .catch(() => attachmentBuffer)
    .then(buffer => Buffer.from(buffer))
    .then(async buffer => {
      console.log(`image buffer length AFTER sharp: ${buffer.length} bytes`); // eslint-disable-line no-console
      console.timeEnd(`orientImageBuffer`); // eslint-disable-line no-console
      return buffer;
    });
}

// https://app.platerecognizer.com/upload-limit/
const downscaleForPlateRecognizer = ({ buffer, targetWidth }) => {
  const fileSize = buffer.length;
  const maxFilesize = 2411654;

  if (fileSize < maxFilesize) {
    return buffer;
  }

  // eslint-disable-next-line no-console
  console.log(
    `file size is greater than maximum of ${maxFilesize} bytes, attempting to scale down to width of ${targetWidth}`,
  );

  return sharp(buffer)
    .resize({ width: targetWidth })
    .toBuffer()
    .catch(error => {
      console.error('could not scale down, using unscaled image', { error });
      return buffer;
    })
    .then(resizedBufferish => {
      const resizedBuffer = Buffer.from(resizedBufferish);
      // eslint-disable-next-line no-console
      console.log(
        `file size after scaling down: ${resizedBuffer.length} bytes`,
      );
      return resizedBuffer;
    });
};

function platerecognizer({ attachmentBytesRotated, PLATERECOGNIZER_TOKEN }) {
  const body = new FormData();

  body.append('upload', attachmentBytesRotated);

  // body.append("regions", "us-ny"); // Change to your country
  body.append('regions', 'us'); // Change to your country

  return nodeFetch('https://api.platerecognizer.com/v1/plate-reader/', {
    method: 'POST',
    headers: {
      Authorization: `Token ${PLATERECOGNIZER_TOKEN}`,
    },
    body,
  });
}

export default function readLicenseViaALPR({
  attachmentBuffer,
  PLATERECOGNIZER_TOKEN,
  PLATERECOGNIZER_TOKEN_TWO,
}) {
  return orientImageBuffer({ attachmentBuffer })
    .then(buffer => downscaleForPlateRecognizer({ buffer, targetWidth: 4096 }))
    .then(buffer => downscaleForPlateRecognizer({ buffer, targetWidth: 2048 }))
    .then(buffer => buffer.toString('base64'))
    .then(attachmentBytesRotated => {
      console.log('STARTING platerecognizer'); // eslint-disable-line no-console
      console.time(`/platerecognizer plate-reader`); // eslint-disable-line no-console

      return platerecognizer({ attachmentBytesRotated, PLATERECOGNIZER_TOKEN })
        .then(platerecognizerRes => {
          if (platerecognizerRes.ok) {
            return platerecognizerRes;
          }

          console.info(
            '/platerecognizer plate-reader got an error with first token, trying second',
          );

          return platerecognizer({
            attachmentBytesRotated,
            PLATERECOGNIZER_TOKEN: PLATERECOGNIZER_TOKEN_TWO,
          });
        })
        .then(platerecognizerRes => {
          console.info('/platerecognizer plate-reader', {
            platerecognizerRes,
          });
          return platerecognizerRes;
        })
        .then(platerecognizerRes => platerecognizerRes.json())
        .finally(() => console.timeEnd(`/platerecognizer plate-reader`)); // eslint-disable-line no-console
    });
}
