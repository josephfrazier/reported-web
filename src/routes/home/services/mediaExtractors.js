/**
 * Media extraction functions for EXIF data, license plates, etc.
 */

import * as blobUtil from 'blob-util';
import exifr from 'exifr/dist/full.umd.js';
import axios from 'axios';
import bufferToArrayBuffer from 'buffer-to-arraybuffer';
import objectToFormData from 'object-to-formdata';

import { isImage, isVideo } from '../../../isImage.js';
import getNycTimezoneOffset from '../../../timezone.js';
import { extractLocationDateFromVideo, getVideoScreenshot } from './videoUtils';

/**
 * Convert a blob to buffer and array buffer
 * @param {Object} options
 * @param {Blob} options.attachmentFile - File to convert
 * @returns {Promise<{attachmentBuffer: Buffer, attachmentArrayBuffer: ArrayBuffer}>}
 */
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

/**
 * Extract GPS location from image/video EXIF data
 * @param {Object} options
 * @param {Blob} options.attachmentFile - Media file
 * @param {ArrayBuffer} options.attachmentArrayBuffer - File as ArrayBuffer
 * @param {string} options.ext - File extension
 * @param {boolean} options.isReverseGeocodingEnabled - Whether extraction is enabled
 * @returns {Promise<{latitude: number, longitude: number}>}
 */
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

/**
 * Extract creation date from image/video EXIF data
 * @param {Object} options
 * @param {Blob} options.attachmentFile - Media file
 * @param {ArrayBuffer} options.attachmentArrayBuffer - File as ArrayBuffer
 * @param {string} options.ext - File extension
 * @returns {Promise<{millisecondsSinceEpoch: number, offset: number}>}
 */
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

/**
 * Extract license plate from image/video using ALPR
 * @param {Object} options
 * @param {Blob} options.attachmentFile - Media file
 * @param {Buffer} options.attachmentBuffer - File as Buffer
 * @param {string} options.ext - File extension
 * @param {boolean} options.isAlprEnabled - Whether ALPR is enabled
 * @param {string} options.email - User email for auth
 * @param {string} options.password - User password for auth
 * @param {Object} options.plateCache - Cache for plate results (optional)
 * @param {Function} options.getBlobUrl - Function to get blob URL (optional)
 * @returns {Promise<{plate: string, licenseState: string, plateSuggestions: string[]}>}
 */
export async function extractPlate({
  attachmentFile,
  attachmentBuffer,
  ext,
  isAlprEnabled,
  email,
  password,
  plateCache = null,
  getBlobUrl = null,
}) {
  try {
    console.time('extractPlate'); // eslint-disable-line no-console

    if (isAlprEnabled === false) {
      console.info('ALPR is disabled, skipping');
      return { plate: '', licenseState: '', plateSuggestions: [] };
    }

    // Check cache if provided
    if (plateCache && plateCache.has(attachmentFile)) {
      console.info(`found cached plate for ${attachmentFile.name}!`);
      const result = plateCache.get(attachmentFile);
      return result;
    }

    let bufferToUse = attachmentBuffer;
    if (isVideo({ ext })) {
      bufferToUse = await getVideoScreenshot({ attachmentFile, getBlobUrl });
    } else if (!isImage({ ext })) {
      throw new Error(`${attachmentFile.name} is not an image/video`);
    }

    console.time(`bufferToBlob(${attachmentFile.name})`); // eslint-disable-line no-console
    const attachmentBlob = await blobUtil.arrayBufferToBlob(
      bufferToArrayBuffer(bufferToUse),
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

    // Update cache if provided
    if (plateCache) {
      plateCache.set(attachmentFile, result);
    }

    return result;
  } catch (err) {
    console.error(err.stack);

    throw 'license plate'; // eslint-disable-line no-throw-literal
  } finally {
    console.timeEnd('extractPlate'); // eslint-disable-line no-console
  }
}
