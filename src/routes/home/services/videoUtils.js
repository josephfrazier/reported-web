/**
 * Video processing utilities
 */

import MP4Box from 'mp4box';
import execall from 'execall';
import captureFrame from 'capture-frame';
import pEvent from 'p-event';

/**
 * Extract location and date from video metadata
 * @param {Object} options
 * @param {ArrayBuffer} options.attachmentArrayBuffer - Video file as ArrayBuffer
 * @returns {Array} [{ latitude, longitude }, timestampMs]
 */
export function extractLocationDateFromVideo({ attachmentArrayBuffer }) {
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

/**
 * Capture a screenshot from a video file
 * @param {Object} options
 * @param {Blob} options.attachmentFile - Video file blob
 * @param {Function} options.getBlobUrl - Function to get blob URL (for testability)
 * @returns {Promise<Buffer>} Screenshot image buffer
 */
export async function getVideoScreenshot({
  attachmentFile,
  getBlobUrl = blob => window.URL.createObjectURL(blob),
}) {
  const src =
    typeof getBlobUrl === 'function'
      ? getBlobUrl(attachmentFile)
      : window.URL.createObjectURL(attachmentFile);
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
