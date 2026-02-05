/**
 * File Processing Utilities
 * Extracted from Home.js for better modularity and testability
 */

import * as blobUtil from 'blob-util';
import exifr from 'exifr/dist/full.umd.js';
import MP4Box from 'mp4box';
import execall from 'execall';
import captureFrame from 'capture-frame';
import pEvent from 'p-event';
import bufferToArrayBuffer from 'buffer-to-arraybuffer';
import objectToFormData from 'object-to-formdata';
import axios from 'axios';

import { isImage, isVideo } from '../isImage.js';
import getNycTimezoneOffset from '../timezone.js';

// adapted from https://www.bignerdranch.com/blog/dont-over-react/
const urls = new WeakMap();

export const getBlobUrl = blob => {
  if (urls.has(blob)) {
    return urls.get(blob);
  }
  const blobUrl = window.URL.createObjectURL(blob);
  urls.set(blob, blobUrl);
  return blobUrl;
};

export async function blobToBuffer({ attachmentFile }) {
  console.time(`blobUtil.blobToArrayBuffer(attachmentFile)`); // eslint-disable-line no-console
  const attachmentArrayBuffer = await blobUtil.blobToArrayBuffer(
    attachmentFile,
  );
  console.timeEnd(`blobUtil.blobToArrayBuffer(attachmentFile)`); // eslint-disable-line no-console

  console.time(`Buffer.from(attachmentArrayBuffer)`); // eslint-disable-line no-console
  const attachmentBuffer = Buffer.from(attachmentArrayBuffer);
  console.timeEnd(`Buffer.from(attachmentArrayBuffer)`); // eslint-disable-line no-console

  return { attachmentBuffer, attachmentArrayBuffer };
}

// TODO decouple location/date extraction
function extractLocationDateFromVideo({ attachmentArrayBuffer }) {
  const mp4boxfile = MP4Box.createFile();
  attachmentArrayBuffer.fileStart = 0; // eslint-disable-line no-param-reassign
  mp4boxfile.appendBuffer(attachmentArrayBuffer);
  const info = mp4boxfile.getInfo();
  const { created } = info; // TODO handle missing

  // https://stackoverflow.com/questions/28916329/mp4-video-file-with-gps-location/42596889#42596889
  const uint8array = mp4boxfile.moov.udta['©xyz'].data; // TODO handle missing
  // https://stackoverflow.com/questions/8936984/uint8array-to-string-in-javascript/36949791#36949791
  const string = new TextDecoder('utf-8').decode(uint8array);
  const [latitude, longitude] = execall(/[+-][\d.]+/g, string)
    .map(m => m.match)
    .map(Number);

  // TODO make sure time is correct (ugh timezones...)
  return [{ latitude, longitude }, created.getTime()];
}

// derived from https://github.com/feross/capture-frame/tree/06b8f5eac78fea305f7f577d1697ee3b6999c9a8#complete-example
async function getVideoScreenshot({ attachmentFile }) {
  const src = getBlobUrl(attachmentFile);
  const video = document.createElement('video');

  video.volume = 0;
  video.setAttribute('crossOrigin', 'anonymous'); // optional, when cross-domain
  video.src = src;
  video.play();
  await pEvent(video, 'canplay');

  video.currentTime = 0; // TODO let user choose time?
  await pEvent(video, 'seeked');

  const buf = captureFrame(video).image;

  // unload video element, to prevent memory leaks
  video.pause();
  video.src = '';
  video.load();

  return buf;
}

// adapted from https://www.bignerdranch.com/blog/dont-over-react/
const attachmentPlates = new WeakMap();

export async function extractPlate({
  attachmentFile,
  attachmentBuffer,
  ext,
  isAlprEnabled,
  email,
  password,
}) {
  try {
    console.time('extractPlate'); // eslint-disable-line no-console

    if (isAlprEnabled === false) {
      console.info('ALPR is disabled, skipping');
      return { plate: '', licenseState: '', plateSuggestions: [] };
    }

    if (attachmentPlates.has(attachmentFile)) {
      console.info(`found cached plate for ${attachmentFile.name}!`);
      const result = attachmentPlates.get(attachmentFile);
      return result;
    }

    if (isVideo({ ext })) {
      // eslint-disable-next-line no-param-reassign
      attachmentBuffer = await getVideoScreenshot({ attachmentFile });
    } else if (!isImage({ ext })) {
      throw new Error(`${attachmentFile.name} is not an image/video`);
    }

    console.time(`bufferToBlob(${attachmentFile.name})`); // eslint-disable-line no-console
    const attachmentBlob = await blobUtil.arrayBufferToBlob(
      bufferToArrayBuffer(attachmentBuffer),
    );
    console.timeEnd(`bufferToBlob(${attachmentFile.name})`); // eslint-disable-line no-console

    const formData = objectToFormData({
      attachmentFile: attachmentBlob,
      email,
      password,
    });
    const { data } = await axios.post('/platerecognizer', formData);

    // Choose first result with T######C plate if it exists, see https://github.com/josephfrazier/reported-web/issues/584
    let result = data.results.filter(r =>
      r.plate.toUpperCase().match(/^T\d\d\d\d\d\dC$/),
    )[0];
    if (!result) {
      result = data.results[0];
    }

    try {
      result.licenseState = result.region.code.split('-')[1].toUpperCase();
    } catch (err) {
      result.licenseState = null;
    }
    result.plate = result.plate.toUpperCase();
    result.plateSuggestions = data.results.map(r => r.plate.toUpperCase());

    attachmentPlates.set(attachmentFile, result);
    return result;
  } catch (err) {
    console.error(err.stack);

    throw 'license plate'; // eslint-disable-line no-throw-literal
  } finally {
    console.timeEnd('extractPlate'); // eslint-disable-line no-console
  }
}

export async function extractLocation({
  attachmentFile,
  attachmentArrayBuffer,
  ext,
  isReverseGeocodingEnabled,
}) {
  if (isReverseGeocodingEnabled === false) {
    console.info('Reverse geolocation is disabled, skipping');

    throw 'location'; // eslint-disable-line no-throw-literal
  }

  try {
    if (isVideo({ ext })) {
      return extractLocationDateFromVideo({ attachmentArrayBuffer })[0];
    }
    if (!isImage({ ext })) {
      throw new Error(`${attachmentFile.name} is not an image/video`);
    }

    const { latitude, longitude } = await exifr.gps(attachmentArrayBuffer);
    console.info(
      'Extracted GPS latitude/longitude location from EXIF metadata',
      { latitude, longitude },
    );

    return { latitude, longitude };
  } catch (err) {
    console.error(err.stack);

    throw 'location'; // eslint-disable-line no-throw-literal
  }
}

export async function extractDate({
  attachmentFile,
  attachmentArrayBuffer,
  ext,
}) {
  try {
    if (isVideo({ ext })) {
      return extractLocationDateFromVideo({ attachmentArrayBuffer })[1];
    }
    if (!isImage({ ext })) {
      throw new Error(`${attachmentFile.name} is not an image/video`);
    }

    const {
      CreateDate,
      OffsetTimeDigitized,
    } = await exifr.parse(attachmentArrayBuffer, [
      'CreateDate',
      'OffsetTimeDigitized',
    ]);

    console.log({ CreateDate, OffsetTimeDigitized }); // eslint-disable-line no-console

    return {
      millisecondsSinceEpoch: CreateDate.getTime(),
      offset: OffsetTimeDigitized
        ? parseInt(OffsetTimeDigitized, 10) * -60
        : CreateDate
        ? getNycTimezoneOffset(CreateDate)
        : new Date().getTimezoneOffset(),
    };
  } catch (err) {
    console.error(err.stack);

    throw 'creation date'; // eslint-disable-line no-throw-literal
  }
}
