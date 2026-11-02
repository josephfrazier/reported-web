/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import PropTypes from 'prop-types';
import withStyles from 'isomorphic-style-loader/withStyles';
import FileReaderInput from 'react-file-reader-input';
import * as blobUtil from 'blob-util';
import exifr from 'exifr/dist/full.umd.js';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import promisedLocation from 'promised-location';
import { compose, withProps } from 'recompose';
import {
  withScriptjs,
  withGoogleMap,
  GoogleMap,
  Marker,
} from 'react-google-maps';
import { MAP } from 'react-google-maps/lib/constants';
import debounce from 'debounce-promise';
import { detectFromBuffer } from 'mime-bytes/file-type-detector';
import MP4Box from 'mp4box';
import execall from 'execall';
import captureFrame from 'capture-frame';
import pEvent from 'p-event';
import omit from 'object.omit';
import bufferToArrayBuffer from 'buffer-to-arraybuffer';
import { serialize } from 'object-to-formdata';
import fileExtension from 'file-extension';
import diceware from 'diceware-generator';
import wordlist from 'diceware-wordlist-en-eff';
import Modal from 'react-modal';
import Dropzone from '@josephfrazier/react-dropzone';
import { ToastContainer, toast } from 'react-toastify';
import toastifyStyles from 'react-toastify/dist/ReactToastify.css';
import { zip } from 'zip-array';
import PolygonLookup from 'polygon-lookup';
import CircularProgress from '@mui/material/CircularProgress';

import marx from 'marx-css/css/marx.css';
import usStateNames, { licenseStateName } from '../../usStateNames.js';
import homeStyles from './Home.css';

import PreviousSubmissionsList from '../../components/PreviousSubmissionsList.js';
import {
  HOME_STATE_COOKIE,
  HOME_STATE_MAX_AGE,
  serializeHomeState,
} from '../../homeStateCookie.js';
import formatGeosearchAddress from '../../formatGeosearchAddress.js';
import earliestTakenPhoto from '../../earliestTakenPhoto.js';
import createGeosearchAddressCache from '../../geosearchAddressCache.js';
import { isImage, isVideo } from '../../isImage.js';
import { expandZipFiles } from '../../zipAttachments.js';
import latestLocatedPhoto from '../../latestLocatedPhoto.js';
import plateReadRetry from '../../plateReadRetry.js';
import getNycTimezoneOffset from '../../timezone.js';
import { isPointInNycMemoized } from '../../isPointInNyc.js';
import vehicleTypeUrl from '../../vehicleTypeUrl.js';
import {
  addCachedSubmission,
  clearCachedSubmissions,
  readCachedSubmissions,
  removeCachedSubmission,
  writeCachedSubmissions,
} from './submissionsCache.js';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

// The value is an object; the serialization (and the cookie's attributes)
// live in src/homeStateCookie.js, which the server also uses to read and
// rewrite the same cookie.
const setHomeStateCookie = (state, maxAge) => {
  document.cookie = serializeHomeState(state, {
    maxAge,
    secure: window.location.protocol === 'https:',
  });
};

const debouncedGeosearch = debounce(async ({ latitude, longitude }) => {
  const { data } = await axios.post('/api/geosearch', {
    lat: latitude,
    long: longitude,
  });
  return data;
}, 500);

const howsmydrivingApiUrl = ({ plate, licenseState }) =>
  `https://api.howsmydrivingny.nyc/api/v1/?plate=${plate}:${licenseState}`;

// Fetch and cache per plate+state, so re-selecting a plate that was already
// looked up skips the network call. Caching here — inside the plain
// functions debounce() wraps, rather than at the call sites — means the
// cache is only ever written with the arguments the network request was
// actually made for, never with plates typed while the request was pending.
const getVehicleType = async ({ plate, licenseState, cache }) => {
  const cacheKey = `${plate}:${licenseState}`;
  const cachedVehicleInfoResponse = cache.get(cacheKey)?.vehicleInfoResponse;
  if (cachedVehicleInfoResponse) {
    return cachedVehicleInfoResponse;
  }
  const { data } = await axios.get(`/getVehicleType/${plate}/${licenseState}`);
  cache.set(cacheKey, {
    ...cache.get(cacheKey),
    vehicleInfoResponse: data,
  });
  return data;
};

const getViolations = async ({ plate, licenseState, cache }) => {
  const cacheKey = `${plate}:${licenseState}`;
  const cachedViolationsResponse = cache.get(cacheKey)?.violationsResponse;
  if (cachedViolationsResponse) {
    return cachedViolationsResponse;
  }
  const response = await axios.get(
    howsmydrivingApiUrl({ plate, licenseState }),
  );
  cache.set(cacheKey, {
    ...cache.get(cacheKey),
    violationsResponse: response.data,
  });
  return response.data;
};

const debouncedGetVehicleType = debounce(getVehicleType, 1000);

const debouncedGetViolations = debounce(getViolations, 1000);

const debouncedSavePersistentStateToCookie = debounce(self => {
  self.savePersistentStateToCookie();
}, 500);

const defaultLatitude = 40.7128;
const defaultLongitude = -74.006;

// adapted from https://www.bignerdranch.com/blog/dont-over-react/
const urls = new WeakMap();
const getBlobUrl = blob => {
  if (urls.has(blob)) {
    return urls.get(blob);
  }
  const blobUrl = window.URL.createObjectURL(blob);
  urls.set(blob, blobUrl);
  return blobUrl;
};

// Tracks in-progress background upload promises keyed by File object
const fileUploadPromises = new WeakMap();

// Uploads send bytes this page has read itself rather than the File object
// from the file input. Some browsers (iOS/Safari 26.5.2+, see the
// "Unexpected end of form" section of the README) send an empty request body
// when the process that puts an upload on the wire is the one that has to
// read the file; reading it here first works around that.
const inMemoryAttachment = async ({ attachmentFile }) => {
  const bytes = await blobUtil.blobToArrayBuffer(attachmentFile);
  return new File([bytes], attachmentFile.name, { type: attachmentFile.type });
};

const geolocate = () =>
  promisedLocation().catch(async () => {
    const { data } = await axios.get('https://ipapi.co/json');
    const { latitude, longitude } = data;
    return {
      coords: { latitude, longitude },
      ipProvenance: 'https://ipapi.co/json',
    };
  });

// The time a report is filed with, to the second.
//
// The seconds were stripped here until recently, which left every stored
// report's time a minute wide. They belong to the report: its time is what it
// is, and rounding it is not this function's job. Only the fraction of a second
// goes.
const jsDateToCreateDate = jsDate => jsDate.toISOString().replace(/\..*/g, '');

// The CreateDate field's value for a moment, read in the offset it belongs to.
// `setCreateDate` writes this, and the photos' time is recognised by comparing
// against it: a time the user typed no longer matches what they say.
const createDateValue = ({ millisecondsSinceEpoch, offset }) => {
  // Adjust date to local time
  // https://stackoverflow.com/questions/674721/how-do-i-subtract-minutes-from-a-date-in-javascript
  const MS_PER_MINUTE = 60000;
  return jsDateToCreateDate(
    new Date(millisecondsSinceEpoch - offset * MS_PER_MINUTE),
  );
};

// What the form records as the origin of a location the photos gave it. The
// map and the address field write their own words in its place, which is how a
// place the user set is told from one the photos did -- and the place follows
// the photos only while it is still theirs.
// How many of a thing, in words: "1 picture", "2 pictures".
const countOf = (count, thing) => `${count} ${thing}${count === 1 ? '' : 's'}`;

const EXTRACTED_FROM_PHOTOS = '(extracted from picture/video)';

// The plate field's provenance when the user typed it. The other two are the
// photos' own reading, which is recorded as nothing, and a photo the user
// picked a plate off, which is recorded as that photo's name.
const PLATE_TYPED = 'typed';

// What one of a photo's reads left behind: when it was taken and where, in the
// field names the grouping uses. A value the read did not answer with stays
// NaN, and is passed over by whichever rule is looking.
const emptyReading = file => ({
  file,
  createDateMs: NaN,
  createDateOffset: NaN,
  latitude: NaN,
  longitude: NaN,
});

// A reading's moment, as `setCreateDate` and `createDateValue` take it.
const momentOf = ({ createDateMs, createDateOffset }) => ({
  millisecondsSinceEpoch: createDateMs,
  offset: createDateOffset,
});

async function blobToBuffer({ attachmentFile }) {
  console.time(`blobUtil.blobToArrayBuffer(${attachmentFile.name})`); // eslint-disable-line no-console
  const attachmentArrayBuffer =
    await blobUtil.blobToArrayBuffer(attachmentFile);
  console.timeEnd(`blobUtil.blobToArrayBuffer(${attachmentFile.name})`); // eslint-disable-line no-console

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

  // JPEG, not the default PNG: a lossless PNG frame of a high-res video is
  // tens of megabytes, which trips Plate Recognizer's upload limit even
  // after the server scales it down (see src/alpr.js). JPEG is a fraction
  // of that size and what the API expects anyway.
  const buf = captureFrame(video, 'jpeg').image;

  // unload video element, to prevent memory leaks
  video.pause();
  video.src = '';
  video.load();

  return buf;
}

// adapted from https://www.bignerdranch.com/blog/dont-over-react/
const attachmentPlateCache = new WeakMap();

function getLicenseStateFromPlateResult(result) {
  // ALPR results may not always include a parseable region code. Report that
  // as null rather than an empty string: setLicensePlate leaves the current
  // state alone for null, where '' would clear the field.
  try {
    return result.region.code.split('-')[1].toUpperCase() || null;
  } catch {
    return null;
  }
}

const urlRegex = /(https?:\/\/\S+)/;

// Turn bare URLs in a string into clickable React <a> elements.
// Returns a plain string when there are no URLs, or an array of mixed
// strings and <a> elements otherwise — both valid as JSX children.
function linkifyText(text) {
  if (typeof text !== 'string') return text;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={part} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// Uppercase what the user typed into a controlled <input>, without letting the
// caret jump to the end of the field.
//
// React only writes to a DOM input's `value` when it differs from the value it
// is rendering, and writing to `value` puts the caret at the end. Uppercasing
// in an onChange handler causes exactly that: typing "b" into "A|Z" leaves the
// DOM at "AbZ" while React renders "ABZ", so React rewrites the value and the
// caret lands after the "Z". Digits are unaffected by toUpperCase(), which is
// why they seem to behave.
//
// Writing the uppercased value back here — with the caret where the user left
// it — means React finds the value it's about to render already in place, so it
// leaves both the value and the caret alone.
function upperCaseInputValueInPlace(input) {
  const { value, selectionStart, selectionEnd } = input;
  const upperCased = value.toUpperCase();

  if (upperCased !== value) {
    input.value = upperCased; // eslint-disable-line no-param-reassign

    if (selectionStart !== null && selectionEnd !== null) {
      // Uppercasing can change a character's length (e.g. "ß" -> "SS"), so map
      // each offset through toUpperCase() instead of reusing it as-is.
      input.setSelectionRange(
        value.slice(0, selectionStart).toUpperCase().length,
        value.slice(0, selectionEnd).toUpperCase().length,
      );
    }
  }

  return upperCased;
}

// Attached to the shared axios instance, which is what installs the
// interceptors, but retrying nothing by default. Only the plate read asks for a
// retry, in its own config. Every other request keeps failing straight away,
// `/submit` among them: a submission POST repeated after a 5xx can arrive twice.
axiosRetry(axios, { retries: 0 });

// A 401 means the session is gone: expired, revoked by a logout elsewhere, or
// invalidated by a password reset. Home registers the handler on mount; the
// interceptor lives here because the axios instance is shared.
let onUnauthorized = null;
axios.interceptors.response.use(undefined, error => {
  if (error?.response?.status === 401 && onUnauthorized) {
    onUnauthorized();
  }
  return Promise.reject(error);
});

async function fetchPlateResults({ attachmentFile, attachmentBuffer, ext }) {
  if (attachmentPlateCache.has(attachmentFile)) {
    console.info(`found cached plate results for ${attachmentFile.name}!`);
    return attachmentPlateCache.get(attachmentFile);
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

  // No credentials: /platerecognizer authenticates with the session cookie.
  const formData = serialize({ attachmentFile: attachmentBlob });
  // Plate Recognizer rate limits, so a 429 here is expected rather than
  // exceptional -- and it is transient, which is the difference between a plate
  // read and a photo the user has to type in by hand. What a repeat is worth is
  // in `plateReadRetry`; this asks for it for this request alone.
  console.time(`/platerecognizer round trip (${attachmentFile.name})`); // eslint-disable-line no-console
  const { data } = await axios.post('/platerecognizer', formData, {
    'axios-retry': plateReadRetry,
  });
  console.timeEnd(`/platerecognizer round trip (${attachmentFile.name})`); // eslint-disable-line no-console
  // The server keeps its own clock and sends the breakdown with the reading,
  // so the round trip above splits into what the dyno did and what the network
  // did. A retry adds its wait to the round trip alone, so the two numbers
  // only add up on a request that was answered once.
  console.info(
    `/platerecognizer server timings (${attachmentFile.name})`,
    data.timings,
  );

  attachmentPlateCache.set(attachmentFile, data);
  return data;
}

async function extractPlate({
  attachmentFile,
  attachmentBuffer,
  ext,
  isAlprEnabled,
}) {
  try {
    console.time(`extractPlate(${attachmentFile.name})`); // eslint-disable-line no-console

    if (isAlprEnabled === false) {
      console.info('ALPR is disabled, skipping');
      // Nothing was read, so leave the state field as the person left it:
      // null keeps it, where '' would clear it.
      return { plate: '', licenseState: null };
    }

    const data = await fetchPlateResults({
      attachmentFile,
      attachmentBuffer,
      ext,
    });
    const { results } = data;

    if (!results || results.length === 0) {
      throw new Error('No license plate detected');
    }

    // Choose first result with T######C plate if it exists, see https://github.com/josephfrazier/reported-web/issues/584
    let result = results.filter(r =>
      r.plate?.toUpperCase().match(/^T\d\d\d\d\d\dC$/),
    )[0];
    if (!result) {
      result = results[0];
    }

    try {
      result.licenseState = result.region.code.split('-')[1].toUpperCase();
    } catch {
      result.licenseState = null;
    }
    result.plate = result.plate?.toUpperCase();
    result.allPlateData = data;

    return result;
  } catch (err) {
    console.error(err.stack);

    throw 'license plate'; // eslint-disable-line no-throw-literal
  } finally {
    console.timeEnd(`extractPlate(${attachmentFile.name})`); // eslint-disable-line no-console
  }
}

async function extractLocation({
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

async function extractDate({ attachmentFile, attachmentArrayBuffer, ext }) {
  try {
    if (isVideo({ ext })) {
      return extractLocationDateFromVideo({ attachmentArrayBuffer })[1];
    }
    if (!isImage({ ext })) {
      throw new Error(`${attachmentFile.name} is not an image/video`);
    }

    const { CreateDate, OffsetTimeDigitized } = await exifr.parse(
      attachmentArrayBuffer,
      ['CreateDate', 'OffsetTimeDigitized'],
    );

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

// What the form says when it holds more attachments of one kind than a
// submission carries. One copy, so the note above the button and the refusal
// at submit say the same words.
const TOO_MANY_ATTACHMENTS_MESSAGE =
  'A report can include at most 3 pictures and 3 videos. Remove the extra ones to submit it.';

// What a report without a plate files as. The plate can be out of the picture,
// or unreadable in it, and that is no reason to hold the report back -- but the
// server requires a value, so an empty License/Medallion field is sent as this
// one. The field's placeholder says so, and the field no longer insists on a
// value of its own.
const UNKNOWN_PLATE = 'UNKNOWN';

// Whether the form holds more of one kind of photo than a submission can
// carry.
//
// A submission carries three pictures and three videos, and
// `createSubmission.js` keeps only the first three of each kind. The form
// refuses to send a report that is over either cap, rather than leave the
// extras to be dropped on the way to the report without a word.
function tooManyAttachments(attachmentData) {
  const pictures = attachmentData.filter(file =>
    isImage({ ext: fileExtension(file.name) }),
  ).length;

  return pictures > 3 || attachmentData.length - pictures > 3;
}

class Home extends React.Component {
  static getVehicleMakeLogoUrl({ vehicleMake }) {
    if (vehicleMake.toLowerCase() === 'nissan') {
      return 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Nissan_2020_logo.svg/250px-Nissan_2020_logo.svg.png';
    }
    if (vehicleMake.toLowerCase() === 'honda') {
      return 'https://upload.wikimedia.org/wikipedia/commons/3/38/Honda.svg';
    }
    return `https://img.logo.dev/${vehicleMake}.com?token=pk_dUmX4e3CQxqMliLAmNRIqA`;
  }

  // Whether a LookupAPlate response contains any vehicle data. Empty results
  // are returned for plates without vehicle records (e.g. partial plates
  // typed one character at a time).
  static vehicleInfoResponseHasData(vehicleInfoResponse) {
    const { vehicleYear, vehicleMake, vehicleModel, vehicleBody } =
      vehicleInfoResponse?.result || {};
    return !!(vehicleYear || vehicleMake || vehicleModel || vehicleBody);
  }

  // Render the make/model/year for a plate from a LookupAPlate response.
  static buildVehicleInfoComponent({
    plate,
    licenseState,
    vehicleInfoResponse,
  }) {
    const { vehicleYear, vehicleMake, vehicleModel, vehicleBody } =
      vehicleInfoResponse.result;
    return (
      <React.Fragment>
        <a
          href={vehicleTypeUrl({ licensePlate: plate, licenseState })}
          target="_blank"
          rel="noopener noreferrer"
        >
          {plate} in {licenseStateName(licenseState)}: {vehicleYear}{' '}
          {vehicleMake} {vehicleModel} ({vehicleBody})
        </a>
        <img
          src={Home.getVehicleMakeLogoUrl({ vehicleMake })}
          alt={`${vehicleMake} logo`}
          style={{
            display: 'block',
            maxWidth: '250px',
          }}
        />
      </React.Fragment>
    );
  }

  // Render the error state for a plate whose vehicle could not be looked up.
  static buildVehicleLookupErrorComponent({ plate, licenseState }) {
    return (
      <React.Fragment>
        Could not look up make/model of {plate} in{' '}
        {licenseStateName(licenseState)},{' '}
        <a
          href="https://github.com/josephfrazier/Reported-Web/issues/295"
          target="_blank"
          rel="noopener noreferrer"
        >
          click here for details
        </a>
        <br />
        <a
          href="https://www.lookupaplate.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Click here to manually look it up
        </a>
      </React.Fragment>
    );
  }

  // Render the violation summary for a plate from a howsmydriving response,
  // or null when the response has no vehicle data.
  static buildViolationSummaryComponent({
    plate,
    licenseState,
    violationsResponse,
  }) {
    const vehicle =
      violationsResponse.data &&
      violationsResponse.data[0] &&
      violationsResponse.data[0].vehicle;

    if (!vehicle || !vehicle.violations || !vehicle.fines) {
      return null;
    }

    const totalViolations = vehicle.violations.length;
    const { total_fined: fined, total_outstanding: outstanding } =
      vehicle.fines;

    const lastTweetPart =
      vehicle.tweet_parts &&
      vehicle.tweet_parts[vehicle.tweet_parts.length - 1];
    const urlMatch = lastTweetPart && lastTweetPart.match(/https?:\/\/\S+/);
    const detailsUrl = urlMatch
      ? urlMatch[0].replace(/\.$/, '')
      : 'https://howsmydrivingny.nyc/';

    const firstViolation = vehicle.violations[0];
    const make = firstViolation?.vehicle_make ?? '';
    const color = firstViolation?.vehicle_color ?? '';
    const body = firstViolation?.sanitized?.vehicle_body_type ?? '';

    return (
      <React.Fragment>
        {totalViolations} violation
        {totalViolations !== 1 ? 's' : ''} found{' '}
        {make && `(Maybe: ${color} ${make} ${body})`} — ${fined.toFixed(2)}{' '}
        fined, ${outstanding.toFixed(2)} outstanding
        {' ('}
        <a href={detailsUrl} target="_blank" rel="noopener noreferrer">
          more details
        </a>
        {', or '}
        <a
          href={howsmydrivingApiUrl({ plate, licenseState })}
          target="_blank"
          rel="noopener noreferrer"
        >
          full API response
        </a>
        )
      </React.Fragment>
    );
  }

  static handleAxiosError(error) {
    return Promise.reject(error)
      .catch(err => {
        const { message } = err.response.data.error;

        const isEndOfForm = message === 'Unexpected end of form';
        const addendum = isEndOfForm
          ? '\n\n(Safari or iOS might be causing this, try clearing cookies and site data, or try a different browser or device)'
          : '';

        Home.notifyError(
          `Error: ${err.response.data.error.message} ${addendum}`,
        );
      })
      .catch(err => {
        console.error(err);
      });
  }

  static notifySuccess(notificationContent) {
    return toast.success(notificationContent);
  }

  static notifyInfo(notificationContent) {
    return toast.info(notificationContent);
  }

  static notifyWarning(notificationContent, options) {
    return toast.warn(notificationContent, options);
  }

  static notifyError(notificationContent) {
    return toast.error(notificationContent);
  }

  // What to say about a zip that was picked: how much came out of it, or why
  // nothing did. A zip is how a folder of photos arrives from a phone or a
  // share sheet, and the person who picked it is owed the count either way.
  static reportZip({ name, attachments, failed }) {
    if (failed) {
      Home.notifyError(
        `Could not read ${name}. If it is a zip file, it may be damaged.`,
      );
      return;
    }

    if (attachments.length === 0) {
      Home.notifyWarning(`${name} held no pictures or videos.`);
      return;
    }

    const pictures = attachments.filter(file =>
      isImage({ ext: fileExtension(file.name) }),
    ).length;
    const videos = attachments.length - pictures;
    const parts = [
      pictures > 0 && countOf(pictures, 'picture'),
      videos > 0 && countOf(videos, 'video'),
    ].filter(Boolean);

    Home.notifySuccess(`${parts.join(' and ')} from ${name}`);
  }

  static handleSearchInputMounted(input) {
    // Only a real mount passes the input element; unmounts pass null.
    if (!input) {
      return;
    }
    let attempts = 0;
    const attemptFocus = () => {
      if (document.activeElement === input) {
        return; // focus landed
      }
      attempts += 1;
      if (attempts > 40) {
        return; // give up after ~4s rather than retrying forever
      }
      const { activeElement } = document;
      // The user interacting with the page (clicking a button or the map
      // itself) wins over the deferred focus; don't steal it back.
      const userInteracted =
        ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(
          activeElement?.tagName,
        ) || activeElement?.classList?.contains('gm-style');
      // The input renders into a container that is not in the document yet
      // when this ref fires, and it joins the map's controls only as the map
      // finishes initializing. focus() on a detached element is a no-op, so
      // retry until the input is in the document and the focus sticks.
      if (!userInteracted && document.contains(input)) {
        input.focus();
      }
      if (document.activeElement !== input) {
        setTimeout(attemptFocus, 100);
      }
    };
    requestAnimationFrame(attemptFocus);
  }

  // `setLicensePlate` runs on every keystroke -- the state field is a text
  // input, so typing "NY" is two of them -- and a plate matching an earlier
  // submission matches at each of them. Wait for the typing to stop before
  // saying so, rather than stacking a toast per character. Reusing one toast
  // id means a second pause refreshes the toast that is already up instead of
  // adding another, the way the geosearch warning does.
  debouncedWarnAboutPriorSubmission = debounce(
    ({ priorCount, plate, selectedDateDay }) => {
      const pluralReport = priorCount === 1 ? 'report' : 'reports';

      Home.notifyWarning(
        <p>
          You have already submitted {priorCount} {pluralReport} for {plate} on{' '}
          {selectedDateDay}, are you sure you want to submit another?
        </p>,
        { toastId: 'prior-submission-warning' },
      );
    },
    500,
  );

  constructor(props) {
    super(props);

    const { typeofcomplaintValues } = props;

    const initialStatePerSubmission = {
      email: '',
      FirstName: '',
      LastName: '',
      Phone: '',
      testify: false,

      plate: '',
      licenseState: 'NY',
      // Where the plate in that field came from: undefined while the photos
      // own it, the *name* of a photo whose overlay the user clicked, or
      // PLATE_TYPED when the user typed it. Like the address's provenance, it
      // is what says whether the value follows the photos when they change --
      // see `applyPhotosToForm`.
      plateProvenance: undefined,
      typeofcomplaint: typeofcomplaintValues[0],
      reportDescription: '',
      can_be_shared_publicly: true,
      withhold_contact_info_from_nypd: false,
      receive_nypd_sr_updates_by_email: false,
      latitude: defaultLatitude,
      longitude: defaultLongitude,
      coordsAreInNyc: true,
      formatted_address: '',
      CreateDate: jsDateToCreateDate(new Date()),
    };

    const initialStatePersistent = {
      ...initialStatePerSubmission,
      isAlprEnabled: true,
      isReverseGeocodingEnabled: true,
      isLoadPreviousSubmissionsEnabled: false,
      isMapOpen: false,
      // While this is true, nothing moves the place: see `setCoords`.
      isLocationLocked: false,
      isPreviousSubmissionsOpen: false,
      hasSeenWithholdNotice: false,
      loginSuccessful: false,
    };

    const initialStatePerSession = {
      attachmentData: [],

      // Per session, not persistent: the password is never written to the
      // cookie, and it is not sent to /submit or /api/deleteSubmission
      // (getPerSubmissionState keeps only initialStatePerSubmission keys).
      password: '',

      isAlprLoading: false,
      isPasswordRevealed: false,
      isUserInfoSaving: false,
      isSubmitting: false,
      isPreviousSubmissionsLoading: false,
      hasLoadedPreviousSubmissions: false,
      allPlateData: null,
      vehicleInfoComponent: null,
      violationSummaryComponent: null,
      submissions: [],
      addressProvenance: '',

      plateDataByAttachmentName: {},

      isAuthModalOpen: false,
      authModalTab: 'login',
      isEditProfileOpen: false,
      isPreferencesOpen: false,
      isWithholdFieldHighlighted: false,
      authError: null,
    };

    const initialState = {
      ...initialStatePersistent,
      ...initialStatePerSession,
      // Apply server-provided initial state (from cookie via SSR) over the defaults.
      // This ensures logged-in users see the correct UI immediately on first render.
      ...(props.initialState || {}),
    };
    // A legacy cookie still contains the password; never let it into state.
    initialState.password = '';

    this.state = initialState;
    this.initialStatePerSubmission = initialStatePerSubmission;
    this.initialStatePersistent = initialStatePersistent;
    this.isDragging = false;
    this.plateLookupCache = new Map();
    this.geosearchAddressCache = createGeosearchAddressCache();
    // What each attached photo's reads said, keyed by the file, for as long as
    // it is attached. The form's time and place are worked out from these
    // again whenever the photos change -- see applyPhotosToForm.
    this.photoReadings = new Map();
    this.plateRef = React.createRef();
    this.folderInputRef = React.createRef();
    this.plateLabelRef = React.createRef();
    this.loginEmailRef = React.createRef();
    this.signupEmailRef = React.createRef();
    this.scrollContainerRef = React.createRef();
  }

  componentDidMount() {
    // Handle a 401 from any API call (see the interceptor above).
    onUnauthorized = this.handleSessionExpired;

    // Migrate from old localStorage key ('Function') to cookie.
    // The old localStorage key came from getDisplayName() which resolved to
    // 'Function' for class components. The newer key was 'reportedWebHomeState'.
    // Migrate both old localStorage keys to the cookie if no cookie exists yet.
    //
    // Transitional, and invisible to the server except for the report below:
    // this runs once per browser, in the client. TODO: delete this block, the
    // two keys, and the `removeItem` calls in `clearAuthState` once
    // `[home] legacy localStorage state migrated` has not appeared in the
    // logs for about six months.
    if (!document.cookie.includes(`${HOME_STATE_COOKIE}=`)) {
      const migrateKeys = ['Function', 'reportedWebHomeState'];
      for (const key of migrateKeys) {
        const oldData = localStorage.getItem(key);
        if (oldData) {
          try {
            const parsed = JSON.parse(oldData);
            // Filter to only persistent keys before storing in cookie
            const persistentData = {};
            Object.keys(this.initialStatePersistent).forEach(k => {
              if (k in parsed) persistentData[k] = parsed[k];
            });
            setHomeStateCookie(persistentData, HOME_STATE_MAX_AGE);
            this.setState(persistentData);
            // Let the server log this, so a search can count the browsers
            // that still needed the migration. A lost report is fine.
            axios.post('/api/legacyStateMigrated').catch(() => {});
            break;
          } catch {
            // Ignore parse errors from corrupted data.
          }
        }
      }
    }

    // if there's no attachments or a time couldn't be extracted, just use now
    if (this.state.attachmentData.length === 0 || !this.state.CreateDate) {
      this.setCreateDate({ millisecondsSinceEpoch: Date.now() });
    }

    // Start reverse-geocoding the default coordinates right away so the
    // "Where" button shows an address even before geolocation resolves
    // (or if it fails, e.g. in a private window).
    this.setCoords({
      latitude: defaultLatitude,
      longitude: defaultLongitude,
    });

    // Only request geolocation if the user is already logged in (cookie
    // restores loginSuccessful on page load). For new sessions, defer the
    // browser permission prompt until after the user has logged in, so the
    // prompt appears in a trusted context rather than on first visit.
    if (this.state.loginSuccessful) {
      // Automatic at page load, so don't warn if geosearch is down; the
      // post-login calls keep the warning.
      this.geolocateAndSetCoords({ warnOnGeosearchFailure: false });
    }

    // Allow users to paste image data
    // adapted from https://github.com/charliewilco/react-gluejar/blob/b69d7cfa9d08bfb34d8eb6815e4b548528218883/src/index.js#L85
    window.addEventListener('paste', clipboardEvent => {
      const { items } = clipboardEvent.clipboardData;
      // [].map.call because `items` isn't an array
      const attachmentData = [].map
        .call(items, item => item.getAsFile())
        .filter(file => !!file);

      if (attachmentData.length === 0) {
        return;
      }

      this.handleAttachmentData({ attachmentData });
    });

    window.addEventListener('beforeunload', beforeUnloadEvent => {
      if (this.state.attachmentData.length === 0) {
        return '';
      }

      const confirmationMessage = 'Are you sure?';

      // eslint-disable-next-line no-param-reassign
      (beforeUnloadEvent || window.event).returnValue = confirmationMessage; // Gecko + IE
      return confirmationMessage; // Webkit, Safari, Chrome etc.
    });

    // react-modal only handles Escape when focus is inside the modal
    // content, but the map modal's Google Maps search box captures focus,
    // so listen at the document level instead.
    document.addEventListener('keydown', this.handleDocumentKeyDown);

    this.forceUpdate(); // force "Create/Edit User" fields to render persisted value after load

    if (this.state.isLoadPreviousSubmissionsEnabled) {
      this.loadPreviousSubmissions();
    }

    // Tell react-modal which element holds the page content, so it can mark
    // that element aria-hidden while a modal is open (the "App element is
    // not defined" warning). The element must not contain the modals'
    // portal, which parentSelector renders as a sibling of the container
    // inside the scroll area, so use the container div rather than #app.
    Modal.setAppElement(document.querySelector(`.${homeStyles.container}`));
  }

  componentDidUpdate(prevProps, prevState) {
    if (
      this.state.isAuthModalOpen &&
      (this.state.authModalTab !== prevState.authModalTab ||
        !prevState.isAuthModalOpen)
    ) {
      const ref =
        this.state.authModalTab === 'signup'
          ? this.signupEmailRef
          : this.loginEmailRef;
      requestAnimationFrame(() => {
        if (ref.current) ref.current.focus();
      });
    }
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    onUnauthorized = null;
  }

  onDeleteSubmission = ({ objectId }) => {
    if (!objectId) {
      Home.notifyError(
        'Unable to delete this submission — no objectId available. Try reloading the page and loading previous submissions to get the server-assigned ID.',
      );
      return;
    }
    const confirmationMessage = `Are you sure you want to delete this submission? (objectId: ${objectId})`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmationMessage)) {
      return;
    }
    axios
      .post('/api/deleteSubmission', {
        ...this.getPerSubmissionState(),
        objectId,
      })
      .then(() => {
        // Drop it from the cache too, so it doesn't come back on the next
        // page load before the background fetch replaces the cached list.
        removeCachedSubmission(objectId);

        this.setState(state => ({
          submissions: state.submissions.filter(
            sub => sub.objectId !== objectId,
          ),
        }));
      })
      .catch(error => {
        Home.handleAxiosError(error);
      });
  };

  getPerSubmissionState() {
    return omit(this.state, (val, key) =>
      Object.keys(this.initialStatePerSubmission).includes(key),
    );
  }

  // Request the browser's geolocation permission and update coordinates.
  // Deferred until after login so the permission prompt appears in a trusted
  // context rather than on the first page visit.
  geolocateAndSetCoords = ({ warnOnGeosearchFailure = true } = {}) => {
    // A locked place does not take a fix, so there is nothing to ask for.
    if (this.state.isLocationLocked) {
      return Promise.resolve();
    }

    return geolocate()
      .then(({ coords: { latitude, longitude }, ipProvenance = 'device' }) => {
        // if there's no attachments or a location couldn't be extracted, just use here
        if (
          this.state.attachmentData.length === 0 ||
          (this.state.latitude === defaultLatitude &&
            this.state.longitude === defaultLongitude)
        ) {
          this.setCoords(
            {
              latitude,
              longitude,
              addressProvenance: `(from ${ipProvenance}: ${latitude}, ${longitude})`,
            },
            { warnOnGeosearchFailure },
          );
        }
      })
      .catch(err => {
        // Both browser geolocation and the ipapi.co fallback can fail (e.g.
        // permission denied plus rate limiting). Log instead of leaving an
        // unhandled rejection; the form defaults to NYC coordinates anyway.
        console.error(err);
      });
  };

  setCoords = (
    { latitude, longitude, addressProvenance } = { addressProvenance: '' },
    { warnOnGeosearchFailure = true, fromMap = false } = {},
  ) => {
    // A locked place stays where the user put it. The photos, the GPS and the
    // reset after a submission all ask `setCoords` to move it, so they stop
    // here. The map is the user's own hand, so a place picked there comes
    // through and the lock holds the new place.
    if (this.state.isLocationLocked && !fromMap) {
      return;
    }

    if (!latitude || !longitude) {
      console.error('latitude and/or longitude is missing');
      return;
    }
    this.setState({
      latitude,
      longitude,
      formatted_address: 'Finding Address...',
      addressProvenance,
    });

    // show error message if location is outside NYC
    console.time('new PolygonLookup'); // eslint-disable-line no-console
    const lookup = new PolygonLookup(
      this.props.boroughBoundariesFeatureCollection,
    );
    console.timeEnd('new PolygonLookup'); // eslint-disable-line no-console
    const end = { latitude, longitude };
    if (!isPointInNycMemoized({ lookup, end })) {
      const errorMessage = `latitude/longitude (${latitude}, ${longitude}) is outside NYC. Please select a location within NYC.`;
      this.setState({
        formatted_address: errorMessage,
        coordsAreInNyc: false,
      });
      if (!this.isDragging) {
        Home.notifyError(errorMessage);
      }

      return;
    }
    this.setState({
      coordsAreInNyc: true,
    });

    if (latitude === defaultLatitude && longitude === defaultLongitude) {
      // The default coordinates are a fallback, not a location the user
      // chose — submissions are rejected at these coordinates anyway. Skip
      // the geosearch network call entirely and leave the address empty, so
      // the "Where" button prompts the user to choose a location on the map
      // (and a geosearch outage can't warn before they've picked one).
      this.setState({
        formatted_address: '',
      });
      return;
    }

    // An address is a function of coordinates alone, and the same coordinates
    // come up more than once in a session -- moving the map off a curb and
    // back, for one. What was looked up before can be shown without asking
    // geosearch again.
    const cachedAddress = this.geosearchAddressCache.get({
      latitude,
      longitude,
    });
    if (cachedAddress !== undefined) {
      this.setState({
        formatted_address: cachedAddress,
      });
      toast.dismiss('geosearch-warning');
      return;
    }

    debouncedGeosearch({ latitude, longitude })
      .then(data => {
        const { properties } = data.features[0];

        // Geosearch responses can arrive out of order (the debounce only
        // coalesces calls less than 500ms apart), so ignore a response that
        // isn't for the coordinates currently in state.
        if (
          this.state.latitude === latitude &&
          this.state.longitude === longitude
        ) {
          const address = formatGeosearchAddress(properties);
          // Only a response that is still current is known to be for these
          // coordinates: debounce() resolves every pending call with the last
          // call's response, so the calls this guard discards are carrying
          // some other location's address and must not be filed under this
          // key.
          this.geosearchAddressCache.set({ latitude, longitude, address });
          this.setState({
            formatted_address: address,
          });
          toast.dismiss('geosearch-warning');
        }
      })
      .catch(err => {
        // Geosearch can fail (e.g. when the service is down, or coordinates
        // it can't resolve). The submission can still be created: the
        // backend re-tries the address lookup when it sends the report to
        // 311, and the text sent to 311 includes a Google Maps link to the
        // lat/lng either way.
        console.error(err);
        if (
          this.state.latitude === latitude &&
          this.state.longitude === longitude
        ) {
          this.setState({ formatted_address: '' });
          if (warnOnGeosearchFailure) {
            Home.notifyWarning(
              "We couldn't find the address right now, but you can still submit. The Description sent to 311 will include a Google Maps link to the location.",
              // Reuse the same toast for repeated failures (e.g. while the
              // user keeps moving the map), rather than stacking a new one
              // each time.
              { toastId: 'geosearch-warning' },
            );
          }
        }
      });
  };

  setCreateDate = ({
    millisecondsSinceEpoch,
    offset = new Date().getTimezoneOffset(),
  }) => {
    this.setState({
      CreateDate: createDateValue({ millisecondsSinceEpoch, offset }),
    });
  };

  handleAutocompleteMounted = autocomplete => {
    this.autocomplete = autocomplete;
  };

  renderPlateOverlays = ({ attachmentPlateData, attachmentFile }) =>
    attachmentPlateData?.results?.map(result => {
      const { box } = result;
      const plate = result.plate?.toUpperCase();
      // `box` is in pixels of the image src/alpr.js uploaded to Plate
      // Recognizer, so `uploadWidth`/`uploadHeight` are the denominators that
      // turn it into a fraction of the picture. Percentages are
      // scale-invariant, so that fraction is right however large the browser
      // renders the original file -- do NOT reach for the <img>'s
      // naturalWidth/naturalHeight, which is the pre-downscale size.
      //
      // image_width/image_height are only a fallback for plate data cached
      // before uploadWidth existed. They are NOT interchangeable: Plate
      // Recognizer resizes uploads before processing and reports the resized
      // size (a 2048x2731 upload comes back as 1919x2560), so dividing by them
      // stretches every percentage ~6.7% down and to the right.
      const {
        image_width: imageWidth,
        image_height: imageHeight,
        uploadWidth,
        uploadHeight,
      } = attachmentPlateData;
      const boxWidth = uploadWidth || imageWidth;
      const boxHeight = uploadHeight || imageHeight;
      if (!box || !plate || !boxWidth || !boxHeight) {
        return null;
      }
      const licenseState = getLicenseStateFromPlateResult(result);

      // The overlay for the plate in the License/Medallion field is marked as
      // selected, whether it was typed or clicked. The state is left out of
      // the comparison: it can be hard to tell apart in a photo, and the user
      // chose the plate.
      const isSelected = plate === this.state.plate?.toUpperCase();
      const className = isSelected
        ? `${homeStyles['plate-overlay']} ${homeStyles['plate-overlay-selected']}`
        : homeStyles['plate-overlay'];
      const tooltip = `${isSelected ? '✓ ' : ''}${plate}${
        licenseState ? ` (${licenseState})` : ''
      }`;

      return (
        <button
          type="button"
          key={`${plate}-${box.xmin}-${box.ymin}`}
          className={className}
          style={{
            left: `${(box.xmin / boxWidth) * 100}%`,
            top: `${(box.ymin / boxHeight) * 100}%`,
            width: `${((box.xmax - box.xmin) / boxWidth) * 100}%`,
            height: `${((box.ymax - box.ymin) / boxHeight) * 100}%`,
          }}
          aria-label={`Select license plate ${plate}`}
          onClick={() => {
            // Picked off this picture, so the plate is this picture's to give
            // up: see `plateProvenance`.
            this.setLicensePlate({
              plate,
              licenseState,
              provenance: attachmentFile.name,
            });
            // Bring the License/Medallion label to the top of the screen so
            // the user can confirm the selected plate. The optional call
            // keeps this a no-op in the test renderer, where refs point at
            // non-DOM instances without scrollIntoView.
            this.plateLabelRef.current?.scrollIntoView?.({
              block: 'start',
              behavior: 'smooth',
            });
          }}
        >
          <span className={homeStyles['plate-overlay-tooltip']}>{tooltip}</span>
        </button>
      );
    });

  setLicensePlate = ({ plate, licenseState, provenance = undefined }) => {
    // Both a read that found no state (null) and a caller that left the key
    // off (undefined) leave the current state alone; an empty string is a
    // cleared field and is kept.
    if (licenseState == null) {
      licenseState = this.state.licenseState; // eslint-disable-line no-param-reassign
    }

    // Selecting the plate/state that is already selected (e.g. clicking the
    // overlay for the current plate) is a no-op: skip the
    // duplicate-submission warning and the vehicle/violation lookups. Where
    // the value came from can still have changed -- the same plate read off a
    // photo the user clicked is that photo's to lose -- so the provenance is
    // recorded either way.
    if (
      plate === this.state.plate &&
      licenseState === this.state.licenseState
    ) {
      console.info('ignoring unchanged plate:', plate);

      if (provenance !== this.state.plateProvenance) {
        this.setState({ plateProvenance: provenance });
      }
      return;
    }

    // The debounced lookups cache their HTTP responses per plate+state (see
    // getVehicleType/getViolations), so render a previously-looked-up plate
    // from the cache immediately, without waiting out the debounce.
    const cacheKey = `${plate}:${licenseState}`;
    const cachedLookup = plate && this.plateLookupCache.get(cacheKey);
    const cachedVehicleInfoResponse = cachedLookup?.vehicleInfoResponse;
    const cachedViolationsResponse = cachedLookup?.violationsResponse;
    const cachedVehicleInfoComponent =
      cachedVehicleInfoResponse &&
      (Home.vehicleInfoResponseHasData(cachedVehicleInfoResponse)
        ? Home.buildVehicleInfoComponent({
            plate,
            licenseState,
            vehicleInfoResponse: cachedVehicleInfoResponse,
          })
        : Home.buildVehicleLookupErrorComponent({ plate, licenseState }));
    const cachedViolationSummaryComponent =
      cachedViolationsResponse &&
      Home.buildViolationSummaryComponent({
        plate,
        licenseState,
        violationsResponse: cachedViolationsResponse,
      });

    // LookupAPlate matches a plate together with its state, so a plate with
    // no state is not something it can answer. Ask for the state instead of
    // sending a request that cannot come back with anything.
    const needsLicenseState = Boolean(plate && !licenseState);
    const vehicleInfoMessage = needsLicenseState
      ? `Enter the state to look up make/model for ${plate}`
      : `Looking up make/model for ${plate} in ${licenseStateName(licenseState)}`;
    const violationSummaryMessage = needsLicenseState
      ? `Enter the state to look up violations for ${plate}`
      : `Looking up violations for ${plate} in ${licenseStateName(licenseState)}`;

    this.setState({
      plate,
      licenseState,
      plateProvenance: provenance,
      vehicleInfoComponent:
        cachedVehicleInfoComponent || (plate ? vehicleInfoMessage : null),
      violationSummaryComponent:
        cachedViolationSummaryComponent ||
        (plate ? violationSummaryMessage : null),
    });

    const selectedDate = new Date(this.state.CreateDate);
    const selectedDateDay = selectedDate.toDateString();

    const priorSubmissions = this.state.submissions.filter(submission => {
      const submissionDate = new Date(submission.timeofreport);
      const isSameDay = submissionDate.toDateString() === selectedDateDay;
      if (!isSameDay) {
        return false;
      }

      return submission.license === plate || submission.medallionNo === plate;
    });

    // The warning is about the plate, and the state is deliberately not part of
    // what counts as a duplicate: a state read off a plate is a guess, and an
    // earlier report may simply have got it wrong. So a change to the state on
    // its own says nothing about one -- only a plate that has just become this
    // one is news.
    const priorCount = priorSubmissions.length;
    const plateChanged = plate !== this.state.plate;

    if (priorCount > 0 && plateChanged) {
      this.debouncedWarnAboutPriorSubmission({
        priorCount,
        plate,
        selectedDateDay,
      });
    }

    // An empty plate (after a submission, or when the field is cleared) has
    // nothing to look up: the request would be /getVehicleType//NY, which the
    // server answers with a 404. Neither has a plate with no state, for the
    // same reason: the lookup matches on both, and the message above already
    // asks for the missing half.
    if (plate && licenseState && !cachedVehicleInfoComponent) {
      debouncedGetVehicleType({
        plate,
        licenseState,
        cache: this.plateLookupCache,
      })
        .then(vehicleInfoResponse => {
          // Ignore responses for plates the user has moved on from: the
          // debounced lookup resolves every selection made while it was
          // pending with the LAST plate's data.
          if (plate !== this.state.plate) {
            console.info('ignoring stale plate:', plate);
            return;
          }

          // LookupAPlate returns an empty result for plates without vehicle
          // records (e.g. partial plates typed one character at a time). Fall
          // through to the error path, which renders a manual lookup link
          // instead of "undefined" make/model fields.
          if (!Home.vehicleInfoResponseHasData(vehicleInfoResponse)) {
            throw new Error(`No make/model data for ${plate}`);
          }

          this.setState({
            vehicleInfoComponent: Home.buildVehicleInfoComponent({
              plate,
              licenseState,
              vehicleInfoResponse,
            }),
          });
        })
        .catch(err => {
          console.warn(err);

          if (plate !== this.state.plate) {
            console.info('ignoring stale plate:', plate);
            return;
          }

          if (plate) {
            this.setState({
              vehicleInfoComponent: Home.buildVehicleLookupErrorComponent({
                plate,
                licenseState,
              }),
            });

            // autocorrect common license plate typos from ALPR/OCR
            if (plate.match(/^1\d\d\d\d\d\dC$/)) {
              this.setLicensePlate({
                plate: plate.replace('1', 'T'),
                licenseState,
                provenance: this.state.plateProvenance,
              });
            } else if (plate.match(/^\d\d\d\d\d\dC$/)) {
              this.setLicensePlate({
                plate: `T${plate}`,
                licenseState,
              });
            }
            // Commented out due to https://github.com/josephfrazier/Reported-Web/issues/295
            //
            // } else if (licenseState !== 'NY') {
            //   this.setLicensePlate({
            //     plate,
            //     licenseState: 'NY',
            //   });
            // }
          }
        });
    }

    if (plate && licenseState && !cachedViolationSummaryComponent) {
      debouncedGetViolations({
        plate,
        licenseState,
        cache: this.plateLookupCache,
      })
        .then(responseData => {
          // Ignore responses for plates the user has moved on from: the
          // debounced lookup resolves every selection made while it was
          // pending with the LAST plate's data.
          if (plate !== this.state.plate) {
            return;
          }

          const vehicle =
            responseData.data &&
            responseData.data[0] &&
            responseData.data[0].vehicle;

          if (!vehicle || !vehicle.violations || !vehicle.fines) {
            return;
          }

          this.setState({
            violationSummaryComponent: Home.buildViolationSummaryComponent({
              plate,
              licenseState,
              violationsResponse: responseData,
            }),
          });
        })
        .catch(err => {
          console.error(err);
        });
    }
  };

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  // A picked folder: every picture and video inside it becomes an attachment.
  //
  // A folder is what a camera roll is, and it holds things that are not
  // attachments -- a stray text file, the `.DS_Store` macOS leaves in every
  // directory -- so the pick is filtered rather than handed on whole.
  handleFolderInput = async event => {
    const files = [...event.target.files];
    // Clear the input, so that picking the same folder again still fires a
    // change event.
    event.target.value = ''; // eslint-disable-line no-param-reassign

    const attachments = files.filter(file => {
      const ext = fileExtension(file.name);
      return isImage({ ext }) || isVideo({ ext });
    });

    if (attachments.length === 0) {
      Home.notifyWarning('That folder held no pictures or videos.');
      return undefined;
    }

    return this.handleAttachmentData({ attachmentData: attachments });
  };

  // The files a picker hands over, with any zip opened out into the
  // attachments it holds. A zip is a way of picking a batch, so it takes no
  // place of its own in the attachment list; what it held is reported either
  // way.
  handleAttachmentFiles = async picked => {
    const { files, zips } = await expandZipFiles(picked);
    zips.forEach(archive => Home.reportZip(archive));

    if (files.length === 0) {
      return undefined;
    }

    return this.handleAttachmentData({ attachmentData: files });
  };

  handleAttachmentInput = async (_, results) => {
    const picked = results.map(([, attachmentFile]) => attachmentFile);
    return this.handleAttachmentFiles(picked);
  };

  // What each of a set of photos read.
  readingsOf = photos =>
    photos.map(file => this.photoReadings.get(file)).filter(Boolean);

  // The CreateDate value a set of photos gives. This is what the field holds
  // while the photos still own the time, and comparing the two is how a time
  // the user typed is told from theirs.
  createDateFor = photos => {
    const earliest = earliestTakenPhoto(this.readingsOf(photos));

    return earliest ? createDateValue(momentOf(earliest)) : undefined;
  };

  // The plate a set of photos reads: the first of them, in the order they are
  // attached, whose read named one. What each photo read is kept by name --
  // `plateDataByAttachmentName` is what the overlays are drawn from, and it
  // loses a photo's entry when that photo goes, so a plate cannot outlive the
  // picture it was read from by being looked up here.
  //
  // The result the reading named is chosen the way `extractPlate` chose it: a
  // medallion's T######C plate if the read offered one, and its first result
  // otherwise, so the field a recompute lands on is the field the reading
  // would have filled.
  plateFromPhotos = photos => {
    for (const file of photos) {
      const results =
        this.state.plateDataByAttachmentName[file.name]?.results || [];
      const preferred = results.find(result =>
        result.plate?.toUpperCase().match(/^T\d{6}C$/),
      );
      const result = preferred || results[0];

      if (result?.plate) {
        return {
          plate: result.plate.toUpperCase(),
          licenseState: getLicenseStateFromPlateResult(result),
        };
      }
    }

    return null;
  };

  // The plate follows the photos the way the time and the place do, with one
  // more provenance to weigh: a plate picked off a photo's overlay is evidence
  // from that picture, so it is kept while that picture is attached and
  // recomputed when it is not. A plate the user typed is theirs and does not
  // move.
  applyPhotosPlate = photos => {
    const { plateProvenance } = this.state;

    if (plateProvenance === PLATE_TYPED) {
      return;
    }

    // The photo the plate was picked from is still attached: the evidence for
    // that choice is here, whatever the other photos read.
    if (plateProvenance && photos.some(file => file.name === plateProvenance)) {
      return;
    }

    const fromPhotos = this.plateFromPhotos(photos);

    if (fromPhotos) {
      this.setLicensePlate({ ...fromPhotos, provenance: undefined });
    } else if (this.state.plate) {
      // Nothing left reads a plate, so the field goes back to empty rather
      // than keeping one from a photo the report no longer holds.
      this.setLicensePlate({
        plate: '',
        licenseState: 'NY',
        provenance: undefined,
      });
    }
  };

  // The plate, time and place a submission takes from the photos it holds,
  // worked out again whenever that set changes: a photo dropped leaves the
  // others to say what they are.
  //
  // Each follows the photos only while it is still what they gave it. A time
  // the user typed no longer matches what they say, and a place the user set
  // carries their own provenance instead. The place needs that guard most: a
  // camera's location can be wrong for every photo in the set, and the user's
  // correction is then the only right one there is.
  //
  // With nothing attached before, there is nothing of the user's to keep, and
  // the photos say what the time and place are.
  applyPhotosToForm = (photos, { previousPhotos = null } = {}) => {
    this.applyPhotosPlate(photos);

    if (photos.length === 0) {
      return;
    }

    const changing = previousPhotos !== null && previousPhotos.length > 0;
    const readings = this.readingsOf(photos);

    const timeIsTheUsers =
      changing && this.state.CreateDate !== this.createDateFor(previousPhotos);
    if (!timeIsTheUsers) {
      this.applyPhotoTime(readings);
    }

    // The place follows the photos only while it is still theirs. A place the
    // user set, or one this device found before any photo arrived, is not the
    // photos' to move -- and on the first attach there is nothing of the
    // user's to keep either way.
    const placeIsThePhotos =
      !changing || this.state.addressProvenance === EXTRACTED_FROM_PHOTOS;
    if (!placeIsThePhotos) {
      return;
    }

    if (latestLocatedPhoto(readings)) {
      this.applyPhotoPlace(readings);
    } else if (changing) {
      // The photos owned the place and none of the ones left has one, so there
      // is nothing to take: drop back to the default rather than keep the
      // place of a photo the submission no longer holds.
      this.setCoords({
        latitude: defaultLatitude,
        longitude: defaultLongitude,
        addressProvenance: '',
      });
    }
  };

  // Given what the photos read, give the form the earliest one's time.
  applyPhotoTime = readings => {
    const earliest = earliestTakenPhoto(readings);
    if (!earliest) {
      return;
    }

    this.setCreateDate(momentOf(earliest));
  };

  // Given what the photos read, move the form to the place the newest one
  // that has coordinates gave.
  applyPhotoPlace = readings => {
    const located = latestLocatedPhoto(readings);
    if (!located) {
      return;
    }

    this.setCoords({
      latitude: located.latitude,
      longitude: located.longitude,
      addressProvenance: EXTRACTED_FROM_PHOTOS,
    });
  };

  // Take one photo out of the submission, from the X on its thumbnail. What
  // the submission's time and place are is asked again once it is gone: they
  // came from the photos, and the photos have changed.
  removeAttachment = name => {
    const previousPhotos = this.state.attachmentData;

    this.setState(
      state => {
        const attachmentData = state.attachmentData.filter(
          file => file.name !== name,
        );

        if (attachmentData.length === 0) {
          // Nothing is left to take a time or a place from.
          this.setCoords({
            latitude: defaultLatitude,
            longitude: defaultLongitude,
          });
          this.setCreateDate({ millisecondsSinceEpoch: Date.now() });
          return {
            attachmentData,
            plate: '',
            licenseState: 'NY',
            allPlateData: null,
            plateDataByAttachmentName: {},
            vehicleInfoComponent: null,
            violationSummaryComponent: null,
          };
        }

        return {
          attachmentData,
          plateDataByAttachmentName: omit(
            state.plateDataByAttachmentName,
            name,
          ),
        };
      },
      () => {
        // The photos that were attached when the user made the change are
        // still the ones on record, so the time and place they gave can be
        // told from the ones the user set. The reading goes once that is
        // settled, not before.
        this.applyPhotosToForm(this.state.attachmentData, {
          previousPhotos,
        });

        previousPhotos
          .filter(file => !this.state.attachmentData.includes(file))
          .forEach(file => this.photoReadings.delete(file));
      },
    );
  };

  handleAttachmentData = async ({ attachmentData }) => {
    // The photos already attached, so that the time and place the user set by
    // hand can be told from the ones the photos gave. `concat` leaves this
    // array alone, so it stays the set as it was before the call.
    const previousPhotos = this.state.attachmentData;

    this.setState(
      state => ({
        attachmentData: state.attachmentData.concat(attachmentData),
      }),
      async () => {
        // Start background upload for each newly added file
        attachmentData.forEach(attachmentFile => {
          if (!fileUploadPromises.has(attachmentFile)) {
            const uploadPromise = (async () => {
              // No credentials: the route authenticates with the session
              // cookie the browser sends.
              const formData = new FormData();
              formData.append(
                'attachmentData',
                await inMemoryAttachment({ attachmentFile }),
              );
              const { data } = await axios.post(
                '/api/uploadAttachment',
                formData,
              );
              return data.id;
            })();
            // The submit handler awaits this promise (catching failures so
            // it can fall back to sending the files directly), so it can sit
            // unhandled until then. Attach a no-op catch so the test runner
            // and the browser console don't flag the rejection in the
            // meantime.
            uploadPromise.catch(() => {});
            fileUploadPromises.set(attachmentFile, uploadPromise);
          }
        });

        const listsOfExtractions = await Promise.all(
          this.state.attachmentData.map(async (attachmentFile, index) => {
            if (attachmentFile.size > 20 * 1000 * 1000) {
              // just under 20MB, should match fileSize in server.js
              Home.notifyWarning(
                <React.Fragment>
                  <p>
                    File #{index + 1} is too big, over 20MB, please remove it
                    and select a smaller one
                  </p>
                </React.Fragment>,
              );
            }

            const { attachmentBuffer, attachmentArrayBuffer } =
              await blobToBuffer({
                attachmentFile,
              });

            const { name: ext } = (await detectFromBuffer(
              attachmentBuffer,
            )) || { name: 'jpg' };

            this.setState({ isAlprLoading: true });

            // What this photo's reads will say, filled in by the two below as
            // they answer. Kept rather than collected for one pass: the form
            // reads them again every time the photos change.
            const reading = emptyReading(attachmentFile);
            this.photoReadings.set(attachmentFile, reading);

            const datePromise = extractDate({
              attachmentFile,
              attachmentArrayBuffer,
              ext,
            });

            return Promise.allSettled([
              extractPlate({
                attachmentFile,
                attachmentBuffer,
                ext,
                isAlprEnabled: this.state.isAlprEnabled,
              })
                .then(result => {
                  if (
                    this.state.plate === '' &&
                    document.activeElement !== this.plateRef.current
                  ) {
                    this.setLicensePlate(result);
                  }
                  this.setState(state => ({
                    allPlateData: result.allPlateData,
                    plateDataByAttachmentName: result.allPlateData
                      ? {
                          ...state.plateDataByAttachmentName,
                          [attachmentFile.name]: result.allPlateData,
                        }
                      : state.plateDataByAttachmentName,
                  }));
                })
                .finally(() => {
                  this.setState({ isAlprLoading: false });
                }),
              // Recorded rather than applied: the time is the earliest
              // photo's, which is not known until every photo has been read.
              datePromise.then(date => {
                reading.createDateMs = date.millisecondsSinceEpoch;
                reading.createDateOffset = date.offset;
              }),
              extractLocation({
                attachmentFile,
                attachmentArrayBuffer,
                ext,
                isReverseGeocodingEnabled: this.state.isReverseGeocodingEnabled,
              }).then(({ latitude, longitude }) => {
                if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
                  throw 'location (may have been stripped by Android, see https://github.com/josephfrazier/reported-web/issues/751 for details)'; // eslint-disable-line no-throw-literal
                }

                // Recorded rather than applied: which photo's place wins is
                // not known until every photo has been read, and applying
                // each one as it arrived left that to whichever read
                // happened to finish last.
                reading.latitude = latitude;
                reading.longitude = longitude;
              }),
            ]);
          }),
        );

        // Every photo has now been read, so the form takes its time and its
        // place from the set as a whole, rather than from each photo in turn.
        this.applyPhotosToForm(this.state.attachmentData, {
          previousPhotos,
        });

        if (listsOfExtractions.length === 0) {
          return;
        }

        const groupedByExtractionType = zip(...listsOfExtractions);
        const rejected = groupedByExtractionType
          .filter(results => results.every(r => r.status === 'rejected'))
          .map(extractions => extractions[0]);

        if (rejected.length === 0) {
          return;
        }

        const missingValuesString = rejected.map(v => v.reason).join(', ');
        const hasMultipleAttachments = this.state.attachmentData.length > 1;
        const fileCopy = hasMultipleAttachments ? 'the files.' : 'the file.';

        Home.notifyWarning(
          <React.Fragment>
            <p>
              Could not extract the {linkifyText(missingValuesString)} from{' '}
              {fileCopy} Please enter/confirm any missing values manually.
            </p>
          </React.Fragment>,
        );
      },
    );
  };

  handleInputChange = event => {
    const { target } = event;
    const value =
      target.type === 'checkbox'
        ? target.checked
        : target.type === 'datetime-local'
          ? target.value.slice(0, 'YYYY-MM-DDThh:mm'.length)
          : target.value;
    const { name } = target;

    const stateChange = { [name]: value };
    // Checking the withhold box counts as having seen the notice, so it
    // stays gone if the box is later unchecked.
    if (name === 'withhold_contact_info_from_nypd' && value === true) {
      stateChange.hasSeenWithholdNotice = true;
    }

    this.setState(stateChange, () =>
      debouncedSavePersistentStateToCookie(this),
    );
  };

  dismissWithholdNotice = () => {
    this.setState({ hasSeenWithholdNotice: true }, () =>
      debouncedSavePersistentStateToCookie(this),
    );
  };

  // Opens Edit Profile and flash-highlights the withhold field so the
  // notice's "Show me how" button points at it.
  showWithholdField = () => {
    this.setState(
      {
        isEditProfileOpen: true,
        isPreferencesOpen: false,
        isWithholdFieldHighlighted: true,
      },
      () => {
        // The flash should be seen: on narrow screens the checkbox can be
        // below the fold, so bring it into view once the panel is open.
        requestAnimationFrame(() => {
          document
            .getElementById('withhold_contact_info_from_nypd')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      },
    );
    clearTimeout(this.withholdHighlightTimeout);
    this.withholdHighlightTimeout = setTimeout(() => {
      this.setState({ isWithholdFieldHighlighted: false });
    }, 3000);
  };

  loadPreviousSubmissions = () => {
    if (this.state.isPreviousSubmissionsLoading) {
      return;
    }

    // Show the cached recent submissions (if any) immediately, then replace
    // them with the fresh list once the fetch completes.
    const cachedSubmissions = readCachedSubmissions();
    if (cachedSubmissions) {
      this.setState({
        submissions: cachedSubmissions,
        hasLoadedPreviousSubmissions: true,
      });
    }

    this.setState({
      isPreviousSubmissionsLoading: true,
    });

    // No body: the route reads none. It authenticates with the session cookie
    // and answers with this reader's submissions. Handing it the form's state
    // meant sending everything in it, files included, for a request that uses
    // none of it.
    axios
      .post('/submissions')
      .then(({ data }) => {
        const { submissions } = data;
        this.setState({
          submissions,
          isPreviousSubmissionsLoading: false,
          hasLoadedPreviousSubmissions: true,
        });
        writeCachedSubmissions(submissions);
      })
      .catch(error => {
        this.setState({
          isPreviousSubmissionsLoading: false,
        });
        Home.handleAxiosError(error);
      });
  };

  openAuthModal = (tab = 'login') => {
    this.setState({
      isAuthModalOpen: true,
      authModalTab: tab,
      authError: null,
      isPasswordRevealed: tab === 'signup',
    });

    if (tab === 'signup') {
      this.maybeGeneratePassword();
    }
  };

  closeAuthModal = () => {
    this.setState({ isAuthModalOpen: false, authError: null });
  };

  handleDocumentKeyDown = event => {
    if (event.key === 'Escape' && this.state.isMapOpen) {
      this.setState({ isMapOpen: false });
    }
  };

  switchAuthTab = tab => {
    this.setState({
      authModalTab: tab,
      authError: null,
      isPasswordRevealed: tab === 'signup',
    });

    if (tab === 'signup') {
      this.maybeGeneratePassword();
    }
  };

  handleLogIn = async e => {
    if (e) e.preventDefault();
    this.setState({ isUserInfoSaving: true, authError: null });
    try {
      const { data } = await axios.post('/api/logIn', {
        email: this.state.email,
        password: this.state.password,
      });
      const {
        FirstName,
        LastName,
        Phone,
        testify,
        can_be_shared_publicly: canBeSharedPublicly,
        withhold_contact_info_from_nypd: withholdContactInfoFromNypd,
        receive_nypd_sr_updates_by_email: receiveNypdSrUpdatesByEmail,
      } = data;
      this.setState(
        state => ({
          FirstName: FirstName || state.FirstName,
          LastName: LastName || state.LastName,
          Phone: Phone || state.Phone,
          testify: typeof testify === 'boolean' ? testify : state.testify,
          // The server sends the user's stored flag when it was saved,
          // so a present boolean wins over the cookie; an absent one
          // falls back to the cookie value.
          can_be_shared_publicly:
            typeof canBeSharedPublicly === 'boolean'
              ? canBeSharedPublicly
              : state.can_be_shared_publicly,
          // Sparse on the user, so absent means the cookie value.
          withhold_contact_info_from_nypd:
            typeof withholdContactInfoFromNypd === 'boolean'
              ? withholdContactInfoFromNypd
              : state.withhold_contact_info_from_nypd,
          receive_nypd_sr_updates_by_email:
            typeof receiveNypdSrUpdatesByEmail === 'boolean'
              ? receiveNypdSrUpdatesByEmail
              : state.receive_nypd_sr_updates_by_email,
          isUserInfoSaving: false,
          isAuthModalOpen: false,
          loginSuccessful: true,
        }),
        () => {
          this.savePersistentStateToCookie();
          this.loadPreviousSubmissions();
          // Now that the user has logged in, request geolocation
          // permission in a trusted context.
          this.geolocateAndSetCoords();
        },
      );
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  handleSignUp = async e => {
    e.preventDefault();
    this.setState({ isUserInfoSaving: true, authError: null });
    try {
      const { data } = await axios.post('/api/logIn', {
        email: this.state.email,
        password: this.state.password,
      });
      const { FirstName, LastName, Phone, testify } = data;
      this.setState(
        state => ({
          FirstName: FirstName || state.FirstName,
          LastName: LastName || state.LastName,
          Phone: Phone || state.Phone,
          testify: typeof testify === 'boolean' ? testify : state.testify,
          loginSuccessful: true,
        }),
        async () => {
          try {
            await axios.post('/saveUser', this.profileFields());
            this.setState({ isUserInfoSaving: false, isAuthModalOpen: false });
            this.savePersistentStateToCookie();
            this.loadPreviousSubmissions();
            // Now that the user has signed up (and is logged in),
            // request geolocation permission in a trusted context.
            this.geolocateAndSetCoords();
          } catch (saveErr) {
            this.setState({
              isUserInfoSaving: false,
              loginSuccessful: false,
            });
            Home.handleAxiosError(saveErr);
          }
        },
      );
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  // The fields /saveUser accepts. The password is never among them: the
  // session cookie identifies the user.
  profileFields = () => {
    const {
      email,
      FirstName,
      LastName,
      Phone,
      testify,
      can_be_shared_publicly: canBeSharedPublicly,
      withhold_contact_info_from_nypd: withholdContactInfoFromNypd,
      receive_nypd_sr_updates_by_email: receiveNypdSrUpdatesByEmail,
    } = this.state;
    return {
      email,
      FirstName,
      LastName,
      Phone,
      testify,
      can_be_shared_publicly: canBeSharedPublicly,
      withhold_contact_info_from_nypd: withholdContactInfoFromNypd,
      receive_nypd_sr_updates_by_email: receiveNypdSrUpdatesByEmail,
    };
  };

  clearAuthState = (extraState = {}) => {
    this.setState(
      {
        email: '',
        password: '',
        FirstName: '',
        LastName: '',
        Phone: '',
        testify: false,
        withhold_contact_info_from_nypd: false,
        receive_nypd_sr_updates_by_email: false,
        hasSeenWithholdNotice: false,
        submissions: [],
        isEditProfileOpen: false,
        isPreferencesOpen: false,
        hasLoadedPreviousSubmissions: false,
        loginSuccessful: false,
        ...extraState,
      },
      () => {
        setHomeStateCookie({}, 0);
        // Remove old localStorage keys so they aren't re-migrated
        // if the user logs back in later.
        localStorage.removeItem('Function');
        localStorage.removeItem('reportedWebHomeState');
        // Don't keep this user's submissions cached after they log out.
        clearCachedSubmissions();
      },
    );
  };

  handleLogOut = () => {
    // Revoke the Parse session server-side, then clear locally whether or not
    // that request succeeds (an unreachable server must not trap the user in
    // a logged-in UI).
    axios.post('/api/logOut').catch(err => console.error({ err }));
    this.clearAuthState();
  };

  // A 401 from any API call: the session is gone. Not shown for requests made
  // while logged out (there is nothing to expire).
  handleSessionExpired = () => {
    if (!this.state.loginSuccessful) {
      return;
    }
    this.clearAuthState({
      isAuthModalOpen: true,
      authError: 'Your session expired, please log in again.',
    });
  };

  handlePasswordReset = async () => {
    const { email } = this.state;
    if (!email) {
      this.setState({ authError: 'Please enter your email address first.' });
      return;
    }
    this.setState({ isUserInfoSaving: true, authError: null });
    try {
      await axios.post('/requestPasswordReset', { email });
      const message = `Please check ${email} to reset your password.`;
      Home.notifyInfo(message);
      this.setState({ isUserInfoSaving: false });
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  handleSaveProfile = async e => {
    e.preventDefault();
    this.setState({ isUserInfoSaving: true });
    try {
      await axios.post('/saveUser', this.profileFields());
      this.setState({ isUserInfoSaving: false, isEditProfileOpen: false });
      this.scrollContainerRef.current?.scrollTo({
        top: 100,
        left: 100,
        behavior: 'smooth',
      });
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  isLoggedIn = () => this.state.loginSuccessful;

  getPreviousSubmissionsSummary = () => {
    const {
      submissions,
      isPreviousSubmissionsLoading,
      hasLoadedPreviousSubmissions,
      isLoadPreviousSubmissionsEnabled,
    } = this.state;

    if (submissions.length > 0) {
      // Cached submissions may be visible while the fresh list loads in the
      // background, so indicate that a load is in progress.
      return isPreviousSubmissionsLoading
        ? `at least ${submissions.length}, loading more...`
        : submissions.length;
    }
    if (hasLoadedPreviousSubmissions) {
      return 0;
    }
    if (isPreviousSubmissionsLoading) {
      return 'loading...';
    }
    return isLoadPreviousSubmissionsEnabled ? 'loading...' : 'expand to load';
  };

  savePersistentStateToCookie = () => {
    const persistentState = {};
    Object.keys(this.initialStatePersistent).forEach(key => {
      persistentState[key] = this.state[key];
    });
    setHomeStateCookie(persistentState, HOME_STATE_MAX_AGE);
  };

  findMatchingPlateThumbnail() {
    let bestPlateCropDataUrl = null;
    let bestConfidence = -1;
    for (const data of Object.values(this.state.plateDataByAttachmentName)) {
      for (const result of data.results || []) {
        if (
          result.plate?.toUpperCase() === this.state.plate?.toUpperCase() &&
          result.plateCropDataUrl
        ) {
          // The same plate can be detected in multiple photos (or multiple
          // times in one photo). Show the crop beside the plate input that
          // Plate Recognizer read with the most confidence, since that is the
          // read most likely to show the plate clearly. `score` is the
          // per-result confidence from the plate-reader response.
          const confidence = result.score || 0;

          if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestPlateCropDataUrl = result.plateCropDataUrl;
          }
        }
      }
    }
    return bestPlateCropDataUrl;
  }

  maybeGeneratePassword() {
    if (!this.state.password) {
      // setTimeout so that test snapshots don't depend on RNG.
      setTimeout(() => {
        const options = {
          language: wordlist,
          wordcount: 6,
          format: 'string',
        };
        this.setState({
          password: diceware(options),
          isPasswordRevealed: true,
        });
      });
    }
  }

  render() {
    const matchingPlateThumbnail = this.findMatchingPlateThumbnail();
    const previousSubmissionsSummary = this.getPreviousSubmissionsSummary();
    const isSettingsPanelOpen =
      this.state.isEditProfileOpen || this.state.isPreferencesOpen;

    return (
      <Dropzone
        className={homeStyles.root}
        onDrop={attachmentData => this.handleAttachmentFiles(attachmentData)}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        }}
        disableClick
      >
        {this.props.showParseServerBanner && (
          <div role="alert" className={homeStyles['non-production-banner']}>
            <span role="img" aria-label="warning">
              ⚠️
            </span>{' '}
            NOT PRODUCTION — using Parse server:{' '}
            <code>{this.props.parseServerUrl || '(unknown)'}</code>
            {this.props.reviewAppUrl && (
              <>
                {' '}
                — deployed from{' '}
                <a href={this.props.reviewAppUrl}>
                  {this.props.reviewAppLabel || this.props.reviewAppUrl}
                </a>
              </>
            )}
          </div>
        )}
        <div className={homeStyles['scroll-area']}>
          <div
            className={homeStyles['scroll-container']}
            ref={this.scrollContainerRef}
          >
            <div className={homeStyles.container}>
              <main>
                <h1>
                  <a
                    href="https://reportedly.weebly.com/"
                    style={{
                      textDecoration: 'underline',
                    }}
                  >
                    Reported
                  </a>
                </h1>

                <ToastContainer
                  position="top-center"
                  autoClose={5000}
                  hideProgressBar={false}
                  newestOnTop={false}
                  closeOnClick
                  rtl={false}
                  pauseOnFocusLoss
                  draggable
                  pauseOnHover
                  theme="dark"
                />

                {/* User Status Bar */}
                <div className={homeStyles['user-status-bar']}>
                  <div className={homeStyles['user-greeting']}>
                    {this.isLoggedIn() ? (
                      <>
                        <span role="img" aria-label="user">
                          👤
                        </span>{' '}
                        {this.state.FirstName
                          ? `${this.state.FirstName} ${this.state.LastName}`
                          : this.state.email}
                      </>
                    ) : (
                      'Not logged in'
                    )}
                  </div>
                  <div className={homeStyles['user-actions']}>
                    {this.isLoggedIn() ? (
                      <>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn-primary']}
                          onClick={() =>
                            this.setState(state => ({
                              isEditProfileOpen: !state.isEditProfileOpen,
                              isPreferencesOpen: false,
                            }))
                          }
                        >
                          {this.state.isEditProfileOpen
                            ? 'Cancel'
                            : 'Edit Profile'}
                        </button>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn']}
                          onClick={() =>
                            this.setState(state => ({
                              isPreferencesOpen: !state.isPreferencesOpen,
                              isEditProfileOpen: false,
                            }))
                          }
                        >
                          {this.state.isPreferencesOpen
                            ? 'Done'
                            : 'Preferences'}
                        </button>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn']}
                          onClick={this.handleLogOut}
                        >
                          Log Out
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn']}
                          onClick={() => this.openAuthModal('login')}
                        >
                          Log In
                        </button>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn-primary']}
                          onClick={() => this.openAuthModal('signup')}
                        >
                          Sign Up
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* One-time notice about the withhold checkbox, until dismissed
                or the box is checked. Not sticky: the non-production banner
                above owns the sticky spot. */}
                {this.isLoggedIn() &&
                  !this.state.withhold_contact_info_from_nypd &&
                  !this.state.hasSeenWithholdNotice && (
                    <div
                      role="alert"
                      className={homeStyles['withhold-notice-banner']}
                    >
                      <span>
                        Getting unwanted phone calls after making submissions?
                        Now you can stop sending your number and email to the
                        cops!
                      </span>
                      <span className={homeStyles['user-actions']}>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn-primary']}
                          onClick={this.showWithholdField}
                        >
                          Show me how
                        </button>
                        <button
                          type="button"
                          className={homeStyles['status-bar-btn']}
                          onClick={this.dismissWithholdNotice}
                        >
                          Dismiss
                        </button>
                      </span>
                    </div>
                  )}

                {/* Edit Profile (shown inline when toggled) */}
                {this.state.isEditProfileOpen && (
                  <form
                    className={homeStyles['edit-profile-section']}
                    onSubmit={this.handleSaveProfile}
                  >
                    <h3>Edit Profile</h3>
                    <fieldset disabled={this.state.isUserInfoSaving}>
                      <label htmlFor="FirstName">
                        First Name:{' '}
                        <input
                          required
                          type="text"
                          id="FirstName"
                          autoComplete="given-name"
                          value={this.state.FirstName}
                          name="FirstName"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="LastName">
                        Last Name:{' '}
                        <input
                          required
                          type="text"
                          id="LastName"
                          autoComplete="family-name"
                          value={this.state.LastName}
                          name="LastName"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="Phone">
                        Phone Number:{' '}
                        <input
                          required
                          type="tel"
                          id="Phone"
                          autoComplete="tel"
                          value={this.state.Phone}
                          name="Phone"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="testify">
                        <input
                          id="testify"
                          type="checkbox"
                          checked={this.state.testify}
                          name="testify"
                          onChange={this.handleInputChange}
                        />{' '}
                        I&apos;m willing to testify at a hearing, which can be
                        done by phone.
                      </label>

                      <label htmlFor="can_be_shared_publicly">
                        <input
                          id="can_be_shared_publicly"
                          type="checkbox"
                          checked={this.state.can_be_shared_publicly}
                          name="can_be_shared_publicly"
                          onChange={this.handleInputChange}
                        />{' '}
                        Allow the photos/videos, description, category, and
                        location to be publicly displayed
                      </label>

                      <label
                        htmlFor="withhold_contact_info_from_nypd"
                        className={
                          this.state.isWithholdFieldHighlighted
                            ? homeStyles['withhold-field-highlight']
                            : undefined
                        }
                      >
                        <input
                          id="withhold_contact_info_from_nypd"
                          type="checkbox"
                          checked={this.state.withhold_contact_info_from_nypd}
                          name="withhold_contact_info_from_nypd"
                          onChange={this.handleInputChange}
                        />{' '}
                        Withhold my contact info from NYPD service requests
                        <br />
                        <small>
                          If you leave this unchecked, NYPD may call or email
                          you about your service requests.
                        </small>
                      </label>

                      {/* Email updates only make sense while contact info is
                      withheld, so the checkbox is only shown then. The flag
                      stays in state (and the cookie) either way, matching the
                      other per-submission checkboxes. */}
                      {this.state.withhold_contact_info_from_nypd && (
                        <div style={{ marginLeft: '1.5em' }}>
                          <label htmlFor="receive_nypd_sr_updates_by_email">
                            <input
                              id="receive_nypd_sr_updates_by_email"
                              type="checkbox"
                              checked={
                                this.state.receive_nypd_sr_updates_by_email
                              }
                              name="receive_nypd_sr_updates_by_email"
                              onChange={this.handleInputChange}
                            />{' '}
                            But still email me status updates about my NYPD
                            service requests
                            <br />
                            <small>
                              Your email will be shared with 311 for your
                              requests; your name and phone stay withheld.
                            </small>
                          </label>
                        </div>
                      )}

                      <button
                        type="submit"
                        className={homeStyles['auth-submit-btn']}
                        disabled={this.state.isUserInfoSaving}
                        style={{ width: 'auto' }}
                      >
                        {this.state.isUserInfoSaving ? 'Saving...' : 'Save'}
                      </button>
                    </fieldset>
                  </form>
                )}

                {/* Preferences (shown inline when toggled). Unlike the Edit
                Profile form above, nothing here needs saving: these toggles
                affect only how the page behaves, not what is submitted, so
                they persist to the cookie as they change. */}
                {this.state.isPreferencesOpen && (
                  <div className={homeStyles['edit-profile-section']}>
                    <h3>Preferences</h3>

                    <label htmlFor="isAlprEnabled">
                      <input
                        id="isAlprEnabled"
                        type="checkbox"
                        checked={this.state.isAlprEnabled}
                        name="isAlprEnabled"
                        onChange={this.handleInputChange}
                      />{' '}
                      Automatically read license plates from pictures/videos
                    </label>

                    <label htmlFor="isReverseGeocodingEnabled">
                      <input
                        id="isReverseGeocodingEnabled"
                        type="checkbox"
                        checked={this.state.isReverseGeocodingEnabled}
                        name="isReverseGeocodingEnabled"
                        onChange={this.handleInputChange}
                      />{' '}
                      Automatically read addresses from pictures/videos
                    </label>

                    <label htmlFor="isLoadPreviousSubmissionsEnabled">
                      <input
                        id="isLoadPreviousSubmissionsEnabled"
                        type="checkbox"
                        checked={this.state.isLoadPreviousSubmissionsEnabled}
                        name="isLoadPreviousSubmissionsEnabled"
                        onChange={this.handleInputChange}
                      />{' '}
                      Load previous submissions on page load
                    </label>
                  </div>
                )}

                {/* Auth Modal */}
                <Modal
                  parentSelector={() =>
                    document.querySelector(`.${homeStyles['scroll-area']}`) ||
                    document.body
                  }
                  isOpen={this.state.isAuthModalOpen}
                  onRequestClose={this.closeAuthModal}
                  style={{
                    // The portal lives in the scroll area below the banner, so
                    // anchor the overlay to that area instead of the viewport.
                    overlay: {
                      position: 'absolute',
                    },
                    content: {
                      maxWidth: '440px',
                      margin: '0 auto',
                      padding: '1.5rem',
                      borderRadius: '8px',
                      bottom: 'auto',
                    },
                  }}
                >
                  {/* Tab bar */}
                  <div className={homeStyles['auth-modal-tabs']}>
                    <button
                      type="button"
                      className={
                        this.state.authModalTab === 'login'
                          ? homeStyles['auth-modal-tab-active']
                          : homeStyles['auth-modal-tab']
                      }
                      onClick={() => this.switchAuthTab('login')}
                    >
                      Log In
                    </button>
                    <button
                      type="button"
                      className={
                        this.state.authModalTab === 'signup'
                          ? homeStyles['auth-modal-tab-active']
                          : homeStyles['auth-modal-tab']
                      }
                      onClick={() => this.switchAuthTab('signup')}
                    >
                      Sign Up
                    </button>
                  </div>

                  {/* Error display */}
                  {this.state.authError && (
                    <div className={homeStyles['auth-error']}>
                      {this.state.authError}
                    </div>
                  )}

                  {/* Log In form */}
                  {this.state.authModalTab === 'login' && (
                    <form
                      className={homeStyles['auth-modal-body']}
                      onSubmit={this.handleLogIn}
                    >
                      <label htmlFor="auth-email">
                        Email:
                        <input
                          ref={this.loginEmailRef}
                          required
                          id="auth-email"
                          type="email"
                          autoComplete="email"
                          value={this.state.email}
                          name="email"
                          onChange={event => {
                            this.handleInputChange({
                              target: {
                                name: event.target.name,
                                value: event.target.value.replace(
                                  /@.*/,
                                  atDomain => atDomain.toLowerCase(),
                                ),
                              },
                            });
                          }}
                        />
                      </label>
                      <label htmlFor="auth-password">
                        Password:
                        <div className={homeStyles['auth-field-row']}>
                          <input
                            required
                            id="auth-password"
                            type={
                              this.state.isPasswordRevealed
                                ? 'text'
                                : 'password'
                            }
                            autoComplete="current-password"
                            value={this.state.password}
                            name="password"
                            onChange={this.handleInputChange}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              this.setState(state => ({
                                isPasswordRevealed: !state.isPasswordRevealed,
                              }));
                            }}
                          >
                            {this.state.isPasswordRevealed ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </label>
                      <button
                        type="submit"
                        className={homeStyles['auth-submit-btn']}
                        disabled={this.state.isUserInfoSaving}
                      >
                        {this.state.isUserInfoSaving
                          ? 'Logging in...'
                          : 'Log In'}
                      </button>
                      <div className={homeStyles['auth-switch-link']}>
                        <button
                          type="button"
                          onClick={this.handlePasswordReset}
                          disabled={this.state.isUserInfoSaving}
                        >
                          Forgot your password?
                        </button>
                      </div>
                      <div className={homeStyles['auth-switch-link']}>
                        (If you cannot log in even after resetting your
                        password, email{' '}
                        <a href="mailto:reportedapp@gmail.com">
                          reportedapp@gmail.com
                        </a>
                        )
                      </div>
                      <div className={homeStyles['auth-switch-link']}>
                        Don&apos;t have an account?{' '}
                        <button
                          type="button"
                          onClick={() => this.switchAuthTab('signup')}
                        >
                          Sign Up
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Sign Up form */}
                  {this.state.authModalTab === 'signup' && (
                    <form
                      className={homeStyles['auth-modal-body']}
                      onSubmit={this.handleSignUp}
                    >
                      <label htmlFor="auth-signup-email">
                        Email:
                        <input
                          ref={this.signupEmailRef}
                          required
                          id="auth-signup-email"
                          type="email"
                          autoComplete="email"
                          value={this.state.email}
                          name="email"
                          onChange={event => {
                            this.handleInputChange({
                              target: {
                                name: event.target.name,
                                value: event.target.value.replace(
                                  /@.*/,
                                  atDomain => atDomain.toLowerCase(),
                                ),
                              },
                            });
                          }}
                        />
                      </label>
                      <label htmlFor="auth-signup-password">
                        Password:
                        <div className={homeStyles['auth-field-row']}>
                          <input
                            required
                            id="auth-signup-password"
                            type={
                              this.state.isPasswordRevealed
                                ? 'text'
                                : 'password'
                            }
                            autoComplete="new-password"
                            value={this.state.password}
                            name="password"
                            onChange={this.handleInputChange}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              this.setState(state => ({
                                isPasswordRevealed: !state.isPasswordRevealed,
                              }));
                            }}
                          >
                            {this.state.isPasswordRevealed ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </label>
                      <label htmlFor="auth-signup-firstname">
                        First Name:
                        <input
                          required
                          id="auth-signup-firstname"
                          type="text"
                          autoComplete="given-name"
                          value={this.state.FirstName}
                          name="FirstName"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="auth-signup-lastname">
                        Last Name:
                        <input
                          required
                          id="auth-signup-lastname"
                          type="text"
                          autoComplete="family-name"
                          value={this.state.LastName}
                          name="LastName"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="auth-signup-phone">
                        Phone Number:
                        <input
                          required
                          id="auth-signup-phone"
                          type="tel"
                          autoComplete="tel"
                          value={this.state.Phone}
                          name="Phone"
                          onChange={this.handleInputChange}
                        />
                      </label>
                      <label htmlFor="auth-signup-testify">
                        <input
                          id="auth-signup-testify"
                          type="checkbox"
                          checked={this.state.testify}
                          name="testify"
                          onChange={this.handleInputChange}
                        />{' '}
                        I&apos;m willing to testify at a hearing, which can be
                        done by phone.
                      </label>
                      <button
                        type="submit"
                        className={homeStyles['auth-submit-btn']}
                        disabled={this.state.isUserInfoSaving}
                      >
                        {this.state.isUserInfoSaving
                          ? 'Creating account...'
                          : 'Sign Up'}
                      </button>
                      <div className={homeStyles['auth-switch-link']}>
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => this.switchAuthTab('login')}
                        >
                          Log In
                        </button>
                      </div>
                    </form>
                  )}
                </Modal>

                {!this.isLoggedIn() && (
                  <div className={homeStyles['auth-prompt']}>
                    <p>
                      Please{' '}
                      <button
                        type="button"
                        onClick={() => this.openAuthModal('login')}
                      >
                        log in
                      </button>{' '}
                      or{' '}
                      <button
                        type="button"
                        onClick={() => this.openAuthModal('signup')}
                      >
                        sign up
                      </button>{' '}
                      to submit a report.
                    </p>
                  </div>
                )}
                {this.isLoggedIn() && !isSettingsPanelOpen && (
                  <form
                    onSubmit={async e => {
                      e.preventDefault();

                      // The button is off while this is true, and this catches the
                      // submit a keyboard makes without it; the server keeps only
                      // the first three of each kind either way.
                      if (tooManyAttachments(this.state.attachmentData)) {
                        Home.notifyError(TOO_MANY_ATTACHMENTS_MESSAGE);
                        return;
                      }

                      if (
                        this.state.latitude === defaultLatitude &&
                        this.state.longitude === defaultLongitude
                      ) {
                        Home.notifyError(
                          'Please provide the location of the incident',
                        );
                        return;
                      }

                      this.setState({
                        isSubmitting: true,
                      });

                      // Collect pre-uploaded IDs for all attachment files
                      const attachmentIds = await Promise.all(
                        this.state.attachmentData.map(async file => {
                          const uploadPromise = fileUploadPromises.get(file);
                          if (!uploadPromise) return null;
                          try {
                            return await uploadPromise;
                          } catch (_err) {
                            console.error(
                              'Background attachment upload failed:',
                              _err,
                            );
                            return null;
                          }
                        }),
                      );
                      const hasAllIds =
                        attachmentIds.length > 0 &&
                        attachmentIds.every(id => id !== null);

                      // Falling back to the files themselves means sending them
                      // again, so read them here rather than handing the network
                      // the Files that came from the file input (see
                      // inMemoryAttachment).
                      const attachmentsToSubmit = !hasAllIds
                        ? await Promise.all(
                            this.state.attachmentData.map(attachmentFile =>
                              inMemoryAttachment({ attachmentFile }),
                            ),
                          )
                        : null;

                      // The report's own fields, without the attachments: the
                      // two ways of sending those are what differ.
                      const reportFields = {
                        ...this.getPerSubmissionState(),
                        // The server requires a plate, and the field may be
                        // empty: the report files as UNKNOWN, which is what
                        // the field's placeholder promises.
                        plate: this.state.plate || UNKNOWN_PLATE,
                        CreateDate: new Date(
                          this.state.CreateDate,
                        ).toISOString(),
                      };

                      axios
                        .post(
                          '/submit',
                          serialize(
                            hasAllIds
                              ? {
                                  ...reportFields,
                                  attachmentIds: JSON.stringify(attachmentIds),
                                }
                              : {
                                  ...reportFields,
                                  attachmentData: attachmentsToSubmit,
                                },
                            { allowEmptyArrays: true },
                          ),
                          {
                            onUploadProgress: progressEvent => {
                              const {
                                loaded: submitProgressValue,
                                total: submitProgressMax,
                              } = progressEvent;

                              this.setState({
                                submitProgressValue,
                                submitProgressMax,
                              });
                            },

                            onDownloadProgress: progressEvent => {
                              const {
                                loaded: submitProgressValue,
                                total: submitProgressMax,
                              } = progressEvent;

                              this.setState({
                                submitProgressValue,
                                submitProgressMax,
                              });
                            },
                          },
                        )
                        .then(({ data }) => {
                          const { submission } = data;
                          this.scrollContainerRef.current?.scrollTo({
                            top: 100,
                            left: 100,
                            behavior: 'smooth',
                          });
                          console.info(
                            `submitted successfully. Returned data: ${JSON.stringify(
                              data,
                              null,
                              2,
                            )}`,
                          );
                          // Cache the new submission now, so the next page load
                          // can show it immediately instead of waiting for the
                          // full fetch of previous submissions to finish.
                          addCachedSubmission(submission);

                          this.setState(state => ({
                            attachmentData: [],
                            submissions: [submission].concat(state.submissions),
                            allPlateData: null,
                            plateDataByAttachmentName: {},
                            vehicleInfoComponent: null,
                            violationSummaryComponent: null,
                            reportDescription: '',
                          }));
                          this.setLicensePlate({
                            plate: '',
                            licenseState: 'NY',
                          });
                          this.setCoords({
                            latitude: defaultLatitude,
                            longitude: defaultLongitude,
                          });
                          Home.notifySuccess(
                            <React.Fragment>
                              <p>Thanks for your submission!</p>
                              <p>
                                Your information has been submitted to Reported.
                                It may take up to 24 hours for it to be
                                processed.
                              </p>

                              {/*
                        <p>objectId: {data.submission.objectId}</p>
                        */}
                            </React.Fragment>,
                          );
                        })
                        .catch(Home.handleAxiosError)
                        .then(() => {
                          this.setState({
                            isSubmitting: false,
                            submitProgressValue: null,
                            submitProgressMax: null,
                          });
                        })
                        .then(() => {
                          this.savePersistentStateToCookie();
                        });
                    }}
                  >
                    <fieldset disabled={this.state.isSubmitting}>
                      <FileReaderInput
                        multiple
                        accept="image/*,video/*,.zip,application/zip,application/x-zip-compressed"
                        as="buffer"
                        onChange={this.handleAttachmentInput}
                        style={{
                          float: 'left',
                          margin: '1px',
                        }}
                      >
                        <button type="button" style={{ whiteSpace: 'wrap' }}>
                          Add pictures/videos (up to 3 each, 20MB max each)
                        </button>
                      </FileReaderInput>

                      <button
                        type="button"
                        style={{
                          float: 'left',
                          margin: '1px',
                        }}
                        onClick={() => this.folderInputRef.current?.click()}
                      >
                        Add folder
                      </button>
                      <input
                        ref={this.folderInputRef}
                        type="file"
                        multiple
                        webkitdirectory=""
                        style={{ display: 'none' }}
                        onChange={this.handleFolderInput}
                      />

                      <div style={{ clear: 'both' }} />

                      {this.state.attachmentData.length > 0 && (
                        <React.Fragment>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                            }}
                          >
                            {this.state.attachmentData.map(attachmentFile => {
                              const { name } = attachmentFile;
                              const ext = fileExtension(name);
                              const isImg = isImage({ ext });
                              const src = getBlobUrl(attachmentFile);
                              const attachmentPlateData =
                                this.state.plateDataByAttachmentName[name];

                              return (
                                <div
                                  key={name}
                                  style={{
                                    width: '33%',
                                    margin: '0.1%',
                                    flexGrow: 1,
                                    position: 'relative',
                                  }}
                                >
                                  <div
                                    style={{
                                      position: 'relative',
                                      display: 'inline-block',
                                      maxWidth: '100%',
                                    }}
                                  >
                                    <a
                                      href={src}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ display: 'block' }}
                                    >
                                      {isImg ? (
                                        <img
                                          src={src}
                                          alt={name}
                                          style={{ display: 'block' }}
                                        />
                                      ) : (
                                        /* eslint-disable-next-line jsx-a11y/media-has-caption */
                                        <video
                                          src={src}
                                          alt={name}
                                          // The position:relative wrapper shrink-
                                          // wraps its content, and plate overlays
                                          // are percentage-positioned against that
                                          // wrapper, so the video must fill it
                                          // exactly like the img above does:
                                          // display:block closes the inline
                                          // baseline gap, and max-width:100%
                                          // (which marx-css gives img but not
                                          // video) keeps the video from
                                          // overflowing the wrapper when it is
                                          // wider than the container.
                                          style={{
                                            display: 'block',
                                            maxWidth: '100%',
                                          }}
                                        />
                                      )}
                                    </a>
                                    {this.renderPlateOverlays({
                                      attachmentPlateData,
                                      attachmentFile,
                                    })}
                                  </div>

                                  <button
                                    type="button"
                                    style={{
                                      position: 'absolute',
                                      top: 0,
                                      right: 0,
                                      padding: 0,
                                      margin: '1px',
                                      color: 'red', // Ubuntu Chrome shows black otherwise
                                      background: 'white',
                                    }}
                                    onClick={() => this.removeAttachment(name)}
                                  >
                                    <span
                                      role="img"
                                      aria-label="Delete photo/video"
                                    >
                                      ❌
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          <label htmlFor="plate" ref={this.plateLabelRef}>
                            License/Medallion:
                            {this.state.isAlprLoading && (
                              <CircularProgress size="1em" />
                            )}
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'flex-start',
                                gap: '0.5rem',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <input
                                  type="search"
                                  value={this.state.plate}
                                  name="plate"
                                  list="plateSuggestions"
                                  autoComplete="off"
                                  ref={this.plateRef}
                                  // A plate is not required: an empty field
                                  // files as UNKNOWN, and the placeholder says
                                  // what that value is.
                                  placeholder={UNKNOWN_PLATE}
                                  onChange={event => {
                                    const plate = upperCaseInputValueInPlace(
                                      event.target,
                                    );
                                    const matchedResult =
                                      this.state.allPlateData?.results?.find(
                                        r => r.plate?.toUpperCase() === plate,
                                      );
                                    const licenseState = matchedResult
                                      ? getLicenseStateFromPlateResult(
                                          matchedResult,
                                        )
                                      : null;
                                    this.setLicensePlate({
                                      plate,
                                      licenseState,
                                      provenance: PLATE_TYPED,
                                    });
                                  }}
                                />
                                <datalist id="plateSuggestions">
                                  {this.state.allPlateData?.results?.map(
                                    result => (
                                      <option
                                        value={result.plate?.toUpperCase()}
                                      />
                                    ),
                                  )}
                                </datalist>
                                <input
                                  type="search"
                                  style={{
                                    marginTop: '0.5rem',
                                  }}
                                  value={this.state.licenseState}
                                  name="licenseState"
                                  list="stateSuggestion"
                                  autoComplete="off"
                                  placeholder="State"
                                  onChange={event => {
                                    this.setLicensePlate({
                                      plate: this.state.plate,
                                      licenseState: upperCaseInputValueInPlace(
                                        event.target,
                                      ),
                                      provenance: PLATE_TYPED,
                                    });
                                  }}
                                />
                                <datalist id="stateSuggestion">
                                  {Object.entries(usStateNames)
                                    .sort(([, name1], [, name2]) =>
                                      name1
                                        .toUpperCase()
                                        .localeCompare(name2.toUpperCase()),
                                    )
                                    .map(([abbr, name]) => (
                                      <option key={abbr} value={abbr}>
                                        {name} ({abbr})
                                      </option>
                                    ))}
                                </datalist>
                              </div>
                              {matchingPlateThumbnail && (
                                <img
                                  src={matchingPlateThumbnail}
                                  alt="Detected license plate"
                                  style={{
                                    maxHeight: '5rem',
                                    maxWidth: '12rem',
                                    objectFit: 'contain',
                                  }}
                                />
                              )}
                            </div>
                            <div>{this.state.violationSummaryComponent}</div>
                            <div>{this.state.vehicleInfoComponent}</div>
                          </label>

                          <label htmlFor="typeofcomplaint">
                            Type:{' '}
                            <select
                              value={this.state.typeofcomplaint}
                              name="typeofcomplaint"
                              onChange={this.handleInputChange}
                            >
                              {this.props.typeofcomplaintValues.map(
                                typeofcomplaint => (
                                  <option
                                    key={typeofcomplaint}
                                    value={typeofcomplaint}
                                  >
                                    {typeofcomplaint}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>

                          <label htmlFor="where">
                            Where: {this.state.addressProvenance}
                            <br />
                            <button
                              type="button"
                              name="where"
                              onClick={() => this.setState({ isMapOpen: true })}
                              style={{
                                width: '100%',
                              }}
                            >
                              {this.state.formatted_address
                                ? this.state.formatted_address
                                    .split(', ')
                                    .slice(0, 2)
                                    .join(', ')
                                : 'Click to choose address on map'}
                            </button>
                          </label>

                          <label htmlFor="isLocationLocked">
                            <input
                              id="isLocationLocked"
                              type="checkbox"
                              checked={this.state.isLocationLocked}
                              name="isLocationLocked"
                              onChange={this.handleInputChange}
                            />{' '}
                            Reuse this address
                          </label>

                          <Modal
                            parentSelector={() =>
                              document.querySelector(
                                `.${homeStyles['scroll-area']}`,
                              ) || document.body
                            }
                            isOpen={this.state.isMapOpen}
                            onRequestClose={() =>
                              this.setState({ isMapOpen: false })
                            }
                            style={{
                              // The portal lives in the scroll area below the
                              // banner, so anchor the overlay to that area
                              // instead of the viewport.
                              overlay: {
                                position: 'absolute',
                              },
                              content: {
                                padding: 0,
                              },
                            }}
                          >
                            <MyMapComponent
                              key="map"
                              position={{
                                lat: this.state.latitude,
                                lng: this.state.longitude,
                              }}
                              onRef={mapRef => {
                                this.mapRef = mapRef;
                              }}
                              onCenterChanged={() => {
                                const latitude = this.mapRef.getCenter().lat();
                                const longitude = this.mapRef.getCenter().lng();
                                this.setCoords(
                                  {
                                    latitude,
                                    longitude,
                                    addressProvenance: '(manually set)',
                                  },
                                  { fromMap: true },
                                );
                              }}
                              onDragStart={() => {
                                this.isDragging = true;
                              }}
                              onDragEnd={() => {
                                this.isDragging = false;
                              }}
                              onAutocompleteMounted={
                                this.handleAutocompleteMounted
                              }
                              onSearchInputMounted={
                                Home.handleSearchInputMounted
                              }
                              onPlacesChanged={() => {
                                // `getPlace()` also returns a geometry-less result
                                // when the user types text without picking a
                                // prediction, so leave the map where it is then.
                                const location =
                                  this.autocomplete.getPlace()?.geometry
                                    ?.location;
                                if (!location) {
                                  return;
                                }

                                this.setCoords(
                                  {
                                    latitude: location.lat(),
                                    longitude: location.lng(),
                                    addressProvenance: '(manually set)',
                                  },
                                  { fromMap: true },
                                );
                              }}
                            />

                            <button
                              type="button"
                              style={{
                                float: 'left',
                              }}
                              onClick={() => {
                                geolocate()
                                  .then(
                                    ({
                                      coords: { latitude, longitude },
                                      ipProvenance = 'device',
                                    }) => {
                                      this.setCoords({
                                        latitude,
                                        longitude,
                                        addressProvenance: `(from ${ipProvenance}: ${latitude}, ${longitude})`,
                                      });
                                    },
                                  )
                                  .catch(err => {
                                    Home.notifyError(err.message);
                                    console.error(err);
                                  });
                              }}
                            >
                              Use current location
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                this.setState({ isMapOpen: false })
                              }
                              style={{
                                float: 'right',
                              }}
                            >
                              Close
                            </button>
                          </Modal>

                          <label htmlFor="CreateDate">
                            When:{' '}
                            <input
                              required
                              type="datetime-local"
                              // Minutes, not the seconds the state carries. The
                              // slice started as a workaround for an iOS picker
                              // that refused a value carrying seconds (issue #11).
                              // It stays on its own account: this is a field for a
                              // person to nudge, and a phone's picker offers no
                              // finer than a minute anyway.
                              value={this.state.CreateDate.slice(0, 16)}
                              name="CreateDate"
                              onChange={this.handleInputChange}
                            />
                          </label>

                          <label htmlFor="reportDescription">
                            Description:{' '}
                            <textarea
                              value={this.state.reportDescription}
                              name="reportDescription"
                              onChange={this.handleInputChange}
                              autoComplete="off"
                            />
                          </label>

                          {this.state.isSubmitting ? (
                            <progress
                              max={this.state.submitProgressMax}
                              value={this.state.submitProgressValue}
                              style={{
                                width: '100%',
                              }}
                            >
                              {this.state.submitProgressValue}/
                              {this.state.submitProgressMax}
                            </progress>
                          ) : (
                            <React.Fragment>
                              {tooManyAttachments(
                                this.state.attachmentData,
                              ) && <p>{TOO_MANY_ATTACHMENTS_MESSAGE}</p>}
                              <button
                                type="submit"
                                disabled={
                                  this.state.isSubmitting ||
                                  !this.state.coordsAreInNyc ||
                                  tooManyAttachments(this.state.attachmentData)
                                }
                                style={{
                                  width: '100%',
                                }}
                              >
                                Submit
                              </button>
                            </React.Fragment>
                          )}
                        </React.Fragment>
                      )}
                    </fieldset>
                  </form>
                )}

                <br />

                {this.isLoggedIn() && !isSettingsPanelOpen && (
                  <details
                    onToggle={evt => {
                      const isPreviousSubmissionsOpen = evt.currentTarget.open;
                      const shouldLoadPreviousSubmissions =
                        isPreviousSubmissionsOpen &&
                        !this.state.isPreviousSubmissionsLoading &&
                        !this.state.isLoadPreviousSubmissionsEnabled &&
                        !this.state.hasLoadedPreviousSubmissions;

                      this.setState(
                        {
                          isPreviousSubmissionsOpen,
                        },
                        () => {
                          if (shouldLoadPreviousSubmissions) {
                            this.loadPreviousSubmissions();
                          }
                        },
                      );
                    }}
                  >
                    <summary>
                      Previous Submissions ({previousSubmissionsSummary})
                    </summary>

                    {this.state.isPreviousSubmissionsOpen && (
                      <PreviousSubmissionsList
                        submissions={this.state.submissions}
                        onDeleteSubmission={this.onDeleteSubmission}
                        isLoading={this.state.isPreviousSubmissionsLoading}
                        hasLoadedPreviousSubmissions={
                          this.state.hasLoadedPreviousSubmissions
                        }
                      />
                    )}
                  </details>
                )}

                <div style={{ float: 'right' }}>
                  <a
                    href="/submissions-map"
                    style={{
                      background: 'black',
                      border: '1em solid black',
                      borderRadius: '2em',
                      textDecoration: 'none',
                    }}
                  >
                    <span role="img" aria-label="world map">
                      🗺️
                    </span>
                  </a>
                </div>

                {this.props.commitHash && (
                  <div
                    style={{
                      clear: 'both',
                      textAlign: 'center',
                      fontSize: '0.75rem',
                      color: '#999',
                      paddingTop: '1rem',
                    }}
                  >
                    <a
                      href={`https://github.com/josephfrazier/reported-web/commit/${this.props.commitHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      // marx.css colours anchors blue and strips their underline,
                      // so keep the footer's grey and put the underline back to
                      // mark the hash as a link.
                      style={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                      {this.props.commitHash}
                    </a>
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      </Dropzone>
    );
  }
}

Home.propTypes = {
  typeofcomplaintValues: PropTypes.arrayOf(PropTypes.string).isRequired,
  boroughBoundariesFeatureCollection: PropTypes.object.isRequired,
  commitHash: PropTypes.string,
  parseServerUrl: PropTypes.string,
  showParseServerBanner: PropTypes.bool,
  reviewAppUrl: PropTypes.string,
  reviewAppLabel: PropTypes.string,
  initialState: PropTypes.object,
};

Home.defaultProps = {
  commitHash: undefined,
  parseServerUrl: undefined,
  showParseServerBanner: false,
  reviewAppUrl: undefined,
  reviewAppLabel: undefined,
  initialState: null,
};

// Google's SearchBox widget cannot keep its predictions inside a region: the
// `bounds` option only biases them, so a search for a name that also occurs
// outside NYC (e.g. "Foodtown van") still offers the out-of-town matches. The
// Autocomplete widget accepts the same bounds and, with `strictBounds`, uses
// them as a filter rather than a hint, so the list holds NYC locations only.
const NYC_BOUNDS = {
  east: -73.700272,
  north: 40.915256,
  south: 40.496044,
  west: -74.255735,
};

export class NycAddressAutocomplete extends React.Component {
  constructor(props) {
    super(props);
    // A map control is a plain DOM node, so render the input into a container
    // of our own, then hand it to the map once the map has mounted and its
    // control containers exist.
    this.containerElement = document.createElement('div');
  }

  componentDidMount() {
    const { onAutocompleteMounted, onPlacesChanged } = this.props;
    this.input = this.containerElement.querySelector('input');
    const autocomplete = new window.google.maps.places.Autocomplete(
      this.input,
      {
        bounds: NYC_BOUNDS,
        componentRestrictions: { country: 'us' },
        strictBounds: true,
      },
    );
    autocomplete.addListener('place_changed', onPlacesChanged);
    onAutocompleteMounted(autocomplete);
    this.controls =
      this.context[MAP].controls[window.google.maps.ControlPosition.TOP_LEFT];
    this.controls.push(this.input);
  }

  componentWillUnmount() {
    // React removes the input from `containerElement` as it unmounts, so put
    // the input back in there before that happens.
    const index = this.controls.getArray().indexOf(this.input);
    if (index !== -1) {
      this.containerElement.appendChild(this.controls.removeAt(index));
    }
  }

  render() {
    const { onSearchInputMounted } = this.props;

    return ReactDOM.createPortal(
      <input
        ref={onSearchInputMounted}
        type="text"
        placeholder="Search..."
        style={{
          boxSizing: `border-box`,
          border: `1px solid transparent`,
          width: `calc(100% - 50px)`,
          height: `32px`,
          marginTop: `6px`,
          padding: `0 12px`,
          borderRadius: `3px`,
          boxShadow: `0 2px 6px rgba(0, 0, 0, 0.3)`,
          fontSize: `16px`,
          outline: `none`,
          textOverflow: `ellipses`,
        }}
      />,
      this.containerElement,
    );
  }
}

NycAddressAutocomplete.propTypes = {
  onAutocompleteMounted: PropTypes.func.isRequired,
  onSearchInputMounted: PropTypes.func.isRequired,
  onPlacesChanged: PropTypes.func.isRequired,
};

NycAddressAutocomplete.contextTypes = {
  [MAP]: PropTypes.object,
};

const MyMapComponentPure = props => {
  const {
    position,
    onRef,
    onCenterChanged,
    onDragStart,
    onDragEnd,
    onAutocompleteMounted,
    onSearchInputMounted,
    onPlacesChanged,
  } = props;

  return (
    <GoogleMap
      defaultZoom={16}
      center={position}
      ref={onRef}
      onCenterChanged={onCenterChanged}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      options={{
        mapTypeControl: false,
        zoomControl: true,
        gestureHandling: 'greedy',
      }}
    >
      <Marker position={position} />
      <NycAddressAutocomplete
        onAutocompleteMounted={onAutocompleteMounted}
        onSearchInputMounted={onSearchInputMounted}
        onPlacesChanged={onPlacesChanged}
      />
    </GoogleMap>
  );
};

MyMapComponentPure.propTypes = {
  position: PropTypes.shape({
    lat: PropTypes.number.isRequired,
    lng: PropTypes.number.isRequired,
  }).isRequired,

  onRef: PropTypes.func.isRequired,
  onCenterChanged: PropTypes.func.isRequired,
  onDragStart: PropTypes.func.isRequired,
  onDragEnd: PropTypes.func.isRequired,
  onAutocompleteMounted: PropTypes.func.isRequired,
  onSearchInputMounted: PropTypes.func.isRequired,
  onPlacesChanged: PropTypes.func.isRequired,
};

// recompose@0.26.0 and react-google-maps@9.4.5 (both unmaintained) call
// the deprecated `React.createFactory()` when the map HOCs are composed
// below, logging a warning once per page load. React implements
// `createFactory` as `createElement.bind(null, type)` plus the `.type`
// property, so reimplement it here without the deprecation warning.
React.createFactory = type => {
  const factory = React.createElement.bind(null, type);
  factory.type = type;
  return factory;
};

const MyMapComponent = compose(
  withProps({
    googleMapURL: `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.exp&libraries=geometry,drawing,places`,
    loadingElement: <div style={{ height: `100%` }} />,
    containerElement: (
      <div style={{ height: `calc(100% - (18px + 1.5rem))` }} />
    ),
    mapElement: <div style={{ height: `100%` }} />,
  }),
  withScriptjs,
  withGoogleMap,
)(MyMapComponentPure);

export default withStyles(marx, homeStyles, toastifyStyles)(Home);
