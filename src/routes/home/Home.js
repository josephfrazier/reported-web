/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import React from 'react';
import PropTypes from 'prop-types';
import withStyles from 'isomorphic-style-loader/withStyles';
import FileReaderInput from 'react-file-reader-input';
import * as blobUtil from 'blob-util';
import exifr from 'exifr/dist/full.umd.js';
import axios from 'axios';
import promisedLocation from 'promised-location';
import { compose, withProps } from 'recompose';
import {
  withScriptjs,
  withGoogleMap,
  GoogleMap,
  Marker,
} from 'react-google-maps';
import { SearchBox } from 'react-google-maps/lib/components/places/SearchBox';
import withLocalStorage from 'react-localstorage';
import debounce from 'debounce-promise';
import FileType from 'file-type/browser';
import MP4Box from 'mp4box';
import execall from 'execall';
import captureFrame from 'capture-frame';
import pEvent from 'p-event';
import omit from 'object.omit';
import bufferToArrayBuffer from 'buffer-to-arraybuffer';
import objectToFormData from 'object-to-formdata';
import usStateNames from 'datasets-us-states-abbr-names';
import fileExtension from 'file-extension';
import diceware from 'diceware-generator';
import wordlist from 'diceware-wordlist-en-eff';
import Modal from 'react-modal';
import Dropzone from '@josephfrazier/react-dropzone';
import { ToastContainer, toast } from 'react-toastify';
import toastifyStyles from 'react-toastify/dist/ReactToastify.css';
import { zip } from 'zip-array';
import PolygonLookup from 'polygon-lookup';
import capitalize from 'capitalize';
import CircularProgress from '@mui/material/CircularProgress';

import marx from 'marx-css/css/marx.css';
import homeStyles from './Home.css';

import PreviousSubmissionsList from '../../components/PreviousSubmissionsList.js';
import PlatePickerModal from './PlatePickerModal.js';
import { isImage, isVideo } from '../../isImage.js';
import getNycTimezoneOffset from '../../timezone.js';
import { getBoroNameMemoized } from '../../getBoroName.js';
import vehicleTypeUrl from '../../vehicleTypeUrl.js';

usStateNames.DC = 'District of Columbia';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

const debouncedProcessValidation = debounce(async ({ latitude, longitude }) => {
  const { data } = await axios.post('/api/process_validation', {
    lat: latitude,
    long: longitude,
  });
  return data;
}, 500);

const debouncedGetVehicleType = debounce(
  ({ plate, licenseState }) =>
    axios.get(`/getVehicleType/${plate}/${licenseState}`),
  1000,
);

const debouncedGetViolations = debounce(async ({ plate, licenseState }) => {
  const apiUrl = `https://api.howsmydrivingny.nyc/api/v1/?plate=${plate}:${licenseState}`;
  const response = await axios.get(apiUrl);

  return { apiUrl, response };
}, 1000);

const debouncedSaveStateToLocalStorage = debounce(self => {
  self.saveStateToLocalStorage();
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

const geolocate = () =>
  promisedLocation().catch(async () => {
    const { data } = await axios.get('https://ipapi.co/json');
    const { latitude, longitude } = data;
    return {
      coords: { latitude, longitude },
      ipProvenance: 'https://ipapi.co/json',
    };
  });

const jsDateToCreateDate = jsDate =>
  jsDate.toISOString().replace(/:\d\d\..*/g, '');

async function blobToBuffer({ attachmentFile }) {
  console.time(`blobUtil.blobToArrayBuffer(attachmentFile)`); // eslint-disable-line no-console
  const attachmentArrayBuffer =
    await blobUtil.blobToArrayBuffer(attachmentFile);
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
const attachmentPlateCache = new WeakMap();

function getLicenseStateFromPlateResult(result) {
  try {
    return result.region.code.split('-')[1].toUpperCase();
  } catch {
    // ALPR results may not always include a parseable region code.
    return '';
  }
}

function getPlateThumbnailKey(plate) {
  return (plate || '').toUpperCase();
}

function getPlateThumbnailsByKey(results = []) {
  return results.reduce((acc, result) => {
    const plate = (result.plate || '').toUpperCase();

    if (!result.plateCropDataUrl || !plate) {
      return acc;
    }

    const key = getPlateThumbnailKey(plate);

    acc[key] = result.plateCropDataUrl;
    return acc;
  }, {});
}

async function fetchPlateResults({
  attachmentFile,
  attachmentBuffer,
  ext,
  email,
  password,
}) {
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

  const formData = objectToFormData({
    attachmentFile: attachmentBlob,
    email,
    password,
  });
  const { data } = await axios.post('/platerecognizer', formData);

  attachmentPlateCache.set(attachmentFile, data.results);
  return data.results;
}

async function extractPlate({
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
      return { plate: '', licenseState: '' };
    }

    const results = await fetchPlateResults({
      attachmentFile,
      attachmentBuffer,
      ext,
      email,
      password,
    });

    // Choose first result with T######C plate if it exists, see https://github.com/josephfrazier/reported-web/issues/584
    let result = results.filter(r =>
      r.plate.toUpperCase().match(/^T\d\d\d\d\d\dC$/),
    )[0];
    if (!result) {
      result = results[0];
    }

    try {
      result.licenseState = result.region.code.split('-')[1].toUpperCase();
    } catch {
      result.licenseState = null;
    }
    result.plate = result.plate.toUpperCase();
    result.allPlateResults = results;

    return result;
  } catch (err) {
    console.error(err.stack);

    throw 'license plate'; // eslint-disable-line no-throw-literal
  } finally {
    console.timeEnd('extractPlate'); // eslint-disable-line no-console
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

  static handleAxiosError(error) {
    return Promise.reject(error)
      .catch(err => {
        const { message } = err.response.data.error;

        const isEndOfForm = message === 'Unexpected end of form';
        const addendum = isEndOfForm
          ? '(Safari/iOS might be causing this, try a different browser/device)'
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

  static notifyWarning(notificationContent) {
    return toast.warn(notificationContent);
  }

  static notifyError(notificationContent) {
    return toast.error(notificationContent);
  }

  constructor(props) {
    super(props);

    const { typeofcomplaintValues } = props;

    const initialStatePerSubmission = {
      email: '',
      password: '',
      FirstName: '',
      LastName: '',
      Phone: '',
      testify: false,

      plate: '',
      licenseState: 'NY',
      typeofcomplaint: typeofcomplaintValues[0],
      reportDescription: '',
      can_be_shared_publicly: false,
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
      isPreviousSubmissionsOpen: false,
    };

    const initialStatePerSession = {
      attachmentData: [],

      isAlprLoading: false,
      isPasswordRevealed: false,
      isUserInfoSaving: false,
      isSubmitting: false,
      isPreviousSubmissionsLoading: false,
      hasLoadedPreviousSubmissions: false,
      allPlateResults: [],
      vehicleInfoComponent: null,
      violationSummaryComponent: null,
      submissions: [],
      addressProvenance: '',

      platePickerModalOpen: false,
      platePickerResults: [],
      platePickerLoading: false,
      plateThumbnailsByKey: {},

      isAuthModalOpen: false,
      authModalTab: 'login',
      isEditProfileOpen: false,
      authError: null,
    };

    const initialState = {
      ...initialStatePersistent,
      ...initialStatePerSession,
    };

    this.state = initialState;
    this.initialStatePerSubmission = initialStatePerSubmission;
    this.initialStatePersistent = initialStatePersistent;
    this.plateRef = React.createRef();
  }

  componentDidMount() {
    // if there's no attachments or a time couldn't be extracted, just use now
    if (this.state.attachmentData.length === 0 || !this.state.CreateDate) {
      this.setCreateDate({ millisecondsSinceEpoch: Date.now() });
    }
    geolocate().then(
      ({ coords: { latitude, longitude }, ipProvenance = 'device' }) => {
        // if there's no attachments or a location couldn't be extracted, just use here
        if (
          this.state.attachmentData.length === 0 ||
          (this.state.latitude === defaultLatitude &&
            this.state.longitude === defaultLongitude)
        ) {
          this.setCoords({
            latitude,
            longitude,
            addressProvenance: `(from ${ipProvenance}: ${latitude}, ${longitude})`,
          });
        }
      },
    );

    // generate a random passphrase for first-time users and show it to them
    if (!this.state.password) {
      // async so that test snapshots don't change
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

    this.forceUpdate(); // force "Create/Edit User" fields to render persisted value after load

    if (this.state.isLoadPreviousSubmissionsEnabled) {
      this.loadPreviousSubmissions();
    }
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

  getLocalStorageKey() {
    return this.props.localStorageKey || 'reported-home-state';
  }

  getStateFilterKeys() {
    // used by react-localstorage to determine which `state` keys to save, see https://github.com/josephfrazier/react-localstorage/tree/75f0303aa775e1625ef9cb0d936b6aa0bcdbaffc#filtering
    return Object.keys(this.initialStatePersistent);
  }

  setCoords = (
    { latitude, longitude, addressProvenance } = { addressProvenance: '' },
  ) => {
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
    const BoroName = getBoroNameMemoized({ lookup, end });
    if (BoroName === '(unknown borough)') {
      const errorMessage = `latitude/longitude (${latitude}, ${longitude}) is outside NYC. Please select a location within NYC.`;
      this.setState({
        formatted_address: errorMessage,
        coordsAreInNyc: false,
      });
      Home.notifyError(errorMessage);

      return;
    }
    this.setState({
      coordsAreInNyc: true,
    });

    debouncedProcessValidation({ latitude, longitude }).then(data => {
      this.setState({
        formatted_address: capitalize.words(
          `${data.geoclient_response.address.houseNumber} ${data.geoclient_response.address.streetName1In}, ${data.geoclient_response.address.firstBoroughName}`,
        ),
      });
    });
  };

  setCreateDate = ({
    millisecondsSinceEpoch,
    offset = new Date().getTimezoneOffset(),
  }) => {
    // Adjust date to local time
    // https://stackoverflow.com/questions/674721/how-do-i-subtract-minutes-from-a-date-in-javascript
    const MS_PER_MINUTE = 60000;
    const CreateDateJsLocal = new Date(
      millisecondsSinceEpoch - offset * MS_PER_MINUTE,
    );

    this.setState({
      CreateDate: jsDateToCreateDate(CreateDateJsLocal),
    });
  };

  setLicensePlate = ({ plate, licenseState }) => {
    licenseState = licenseState || this.state.licenseState; // eslint-disable-line no-param-reassign
    this.setState({
      plate,
      licenseState,
      vehicleInfoComponent: plate
        ? `Looking up make/model for ${plate} in ${usStateNames[licenseState]}`
        : null,
      violationSummaryComponent: plate
        ? `Looking up violations for ${plate} in ${usStateNames[licenseState]}`
        : null,
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

    const priorCount = priorSubmissions.length;

    if (priorCount > 0) {
      const pluralReport = priorCount === 1 ? 'report' : 'reports';

      Home.notifyWarning(
        <p>
          You have already submitted {priorCount} {pluralReport} for {plate} on{' '}
          {selectedDateDay}, are you sure you want to submit another?
        </p>,
      );
    }

    debouncedGetVehicleType({ plate, licenseState })
      .then(({ data }) => {
        const { vehicleYear, vehicleMake, vehicleModel, vehicleBody } =
          data.result;

        if (plate !== this.state.plate) {
          console.info('ignoring stale plate:', plate);
          return;
        }

        this.setState({
          vehicleInfoComponent: (
            <React.Fragment>
              <a
                href={vehicleTypeUrl({ licensePlate: plate, licenseState })}
                target="_blank"
                rel="noopener noreferrer"
              >
                {plate} in {usStateNames[licenseState]}: {vehicleYear}{' '}
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
          ),
        });
      })
      .catch(err => {
        console.error(err);

        if (plate !== this.state.plate) {
          console.info('ignoring stale plate:', plate);
          return;
        }

        if (plate) {
          this.setState({
            vehicleInfoComponent: (
              <React.Fragment>
                Could not look up make/model of {plate} in{' '}
                {usStateNames[licenseState]},{' '}
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
            ),
          });

          // autocorrect common license plate typos from ALPR/OCR
          if (plate.match(/^1\d\d\d\d\d\dC$/)) {
            this.setLicensePlate({
              plate: plate.replace('1', 'T'),
              licenseState,
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

    if (plate) {
      debouncedGetViolations({ plate, licenseState })
        .then(({ apiUrl, response: { data: responseData } }) => {
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

          const totalViolations = vehicle.violations.length;
          const { total_fined: fined, total_outstanding: outstanding } =
            vehicle.fines;

          const lastTweetPart =
            vehicle.tweet_parts &&
            vehicle.tweet_parts[vehicle.tweet_parts.length - 1];
          const urlMatch =
            lastTweetPart && lastTweetPart.match(/https?:\/\/\S+/);
          const detailsUrl = urlMatch
            ? urlMatch[0].replace(/\.$/, '')
            : 'https://howsmydrivingny.nyc/';

          const firstViolation = vehicle.violations[0];
          const make = firstViolation?.vehicle_make ?? '';
          const color = firstViolation?.vehicle_color ?? '';
          const body = firstViolation?.sanitized?.vehicle_body_type ?? '';

          this.setState({
            violationSummaryComponent: (
              <React.Fragment>
                {totalViolations} violation
                {totalViolations !== 1 ? 's' : ''} found{' '}
                {make && `(Maybe: ${color} ${make} ${body})`} — $
                {fined.toFixed(2)} fined, ${outstanding.toFixed(2)} outstanding
                {' ('}
                <a href={detailsUrl} target="_blank" rel="noopener noreferrer">
                  more details
                </a>
                {', or '}
                <a href={apiUrl} target="_blank" rel="noopener noreferrer">
                  full API response
                </a>
                )
              </React.Fragment>
            ),
          });
        })
        .catch(err => {
          console.error(err);
        });
    }
  };

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  handleAttachmentInput = async (_, results) => {
    const attachmentData = results.map(([, attachmentFile]) => attachmentFile);

    return this.handleAttachmentData({ attachmentData });
  };

  handleAttachmentData = async ({ attachmentData }) => {
    this.setState(
      state => ({
        attachmentData: state.attachmentData.concat(attachmentData),
      }),
      async () => {
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

            const { ext } = await FileType.fromBuffer(attachmentBuffer);

            this.setState({ isAlprLoading: true });
            return Promise.allSettled([
              extractPlate({
                attachmentFile,
                attachmentBuffer,
                ext,
                isAlprEnabled: this.state.isAlprEnabled,
                email: this.state.email,
                password: this.state.password,
              })
                .then(result => {
                  if (
                    this.state.plate === '' &&
                    document.activeElement !== this.plateRef.current
                  ) {
                    this.setLicensePlate(result);
                  }
                  this.setState(state => ({
                    allPlateResults: result.allPlateResults,
                    plateThumbnailsByKey: {
                      ...state.plateThumbnailsByKey,
                      ...getPlateThumbnailsByKey(result.allPlateResults),
                    },
                  }));
                })
                .finally(() => {
                  this.setState({ isAlprLoading: false });
                }),
              extractDate({
                attachmentFile,
                attachmentArrayBuffer,
                ext,
              }).then(this.setCreateDate),
              extractLocation({
                attachmentFile,
                attachmentArrayBuffer,
                ext,
                isReverseGeocodingEnabled: this.state.isReverseGeocodingEnabled,
              }).then(({ latitude, longitude }) => {
                if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
                  throw 'location (may have been stripped by Android, see <a href="https://github.com/josephfrazier/reported-web/issues/751">details</a>)'; // eslint-disable-line no-throw-literal
                }

                this.setCoords({
                  latitude,
                  longitude,
                  addressProvenance: '(extracted from picture/video)',
                });
              }),
            ]);
          }),
        );

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

        const missingValuesHtml = rejected.map(v => v.reason).join(', ');
        const hasMultipleAttachments = this.state.attachmentData.length > 1;
        const fileCopy = hasMultipleAttachments ? 'the files.' : 'the file.';

        Home.notifyWarning(
          <React.Fragment>
            <p>
              Could not extract the{' '}
              <span dangerouslySetInnerHTML={{ __html: missingValuesHtml }} />{' '}
              from {fileCopy} Please enter/confirm any missing values manually.
            </p>
          </React.Fragment>,
        );
      },
    );
  };

  handlePlatePickerClick = async attachmentFile => {
    this.setState({ platePickerLoading: true });

    try {
      const { email, password } = this.state;
      const { attachmentBuffer } = await blobToBuffer({ attachmentFile });
      const ext = fileExtension(attachmentFile.name);
      const results = await fetchPlateResults({
        attachmentFile,
        attachmentBuffer,
        ext,
        email,
        password,
      });

      this.setState(state => ({
        platePickerResults: results,
        platePickerModalOpen: true,
        platePickerLoading: false,
        plateThumbnailsByKey: {
          ...state.plateThumbnailsByKey,
          ...getPlateThumbnailsByKey(results),
        },
      }));
    } catch (err) {
      console.error(err);
      Home.notifyError('Could not read license plates from this photo.');
      this.setState({ platePickerLoading: false });
    }
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

    this.setState(
      {
        [name]: value,
      },
      () => debouncedSaveStateToLocalStorage(this),
    );
  };

  loadPreviousSubmissions = () => {
    if (this.state.isPreviousSubmissionsLoading) {
      return;
    }

    this.setState({
      isPreviousSubmissionsLoading: true,
    });

    axios
      .post('/submissions', this.state)
      .then(({ data }) => {
        const { submissions } = data;
        this.setState({
          submissions,
          isPreviousSubmissionsLoading: false,
          hasLoadedPreviousSubmissions: true,
        });
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
    });
  };

  closeAuthModal = () => {
    this.setState({ isAuthModalOpen: false, authError: null });
  };

  switchAuthTab = tab => {
    this.setState({ authModalTab: tab, authError: null });
  };

  handleLogIn = async () => {
    this.setState({ isUserInfoSaving: true, authError: null });
    try {
      const { data } = await axios.post('/api/logIn', this.state);
      const { FirstName, LastName, Phone, testify } = data;
      this.setState(
        state => ({
          FirstName: FirstName || state.FirstName,
          LastName: LastName || state.LastName,
          Phone: Phone || state.Phone,
          testify: testify || state.testify,
          isUserInfoSaving: false,
          isAuthModalOpen: false,
        }),
        () => {
          this.saveStateToLocalStorage();
          this.loadPreviousSubmissions();
        },
      );
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  handleSignUp = async () => {
    this.setState({ isUserInfoSaving: true, authError: null });
    try {
      const { data } = await axios.post('/api/logIn', this.state);
      const { FirstName, LastName, Phone, testify } = data;
      this.setState(
        state => ({
          FirstName: FirstName || state.FirstName,
          LastName: LastName || state.LastName,
          Phone: Phone || state.Phone,
          testify: testify || state.testify,
        }),
        async () => {
          try {
            await axios.post('/saveUser', this.state);
            this.setState({ isUserInfoSaving: false, isAuthModalOpen: false });
            this.saveStateToLocalStorage();
            this.loadPreviousSubmissions();
          } catch (saveErr) {
            this.setState({ isUserInfoSaving: false });
            Home.handleAxiosError(saveErr);
          }
        },
      );
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  handleLogOut = () => {
    this.setState(
      {
        email: '',
        password: '',
        FirstName: '',
        LastName: '',
        Phone: '',
        testify: false,
        submissions: [],
        isEditProfileOpen: false,
        hasLoadedPreviousSubmissions: false,
      },
      () => {
        localStorage.removeItem(this.getLocalStorageKey());
      },
    );
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
      await axios.post('/saveUser', this.state);
      this.setState({ isUserInfoSaving: false, isEditProfileOpen: false });
      document.querySelector(`.${homeStyles.root}`).scrollTo({
        top: 100,
        left: 100,
        behavior: 'smooth',
      });
    } catch (err) {
      this.setState({ isUserInfoSaving: false });
      Home.handleAxiosError(err);
    }
  };

  isLoggedIn = () => !!this.state.email;

  getPreviousSubmissionsSummary = () => {
    const {
      submissions,
      isPreviousSubmissionsLoading,
      hasLoadedPreviousSubmissions,
      isLoadPreviousSubmissionsEnabled,
    } = this.state;

    if (submissions.length > 0) {
      return submissions.length;
    }
    if (hasLoadedPreviousSubmissions) {
      return 0;
    }
    if (isPreviousSubmissionsLoading) {
      return 'loading...';
    }
    return isLoadPreviousSubmissionsEnabled ? 'loading...' : 'expand to load';
  };

  render() {
    const matchingPlateThumbnail =
      this.state.plateThumbnailsByKey[getPlateThumbnailKey(this.state.plate)];
    const previousSubmissionsSummary = this.getPreviousSubmissionsSummary();

    return (
      <Dropzone
        className={homeStyles.root}
        onDrop={attachmentData => {
          this.handleAttachmentData({ attachmentData });
        }}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          overflowY: 'scroll',
        }}
        disableClick
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
                        }))
                      }
                    >
                      {this.state.isEditProfileOpen ? 'Cancel' : 'Edit Profile'}
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
                    I&apos;m willing to testify at a hearing, which can be done
                    by phone.
                  </label>
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

            {/* Auth Modal */}
            <Modal
              parentSelector={() =>
                document.querySelector(`.${homeStyles.root}`) || document.body
              }
              isOpen={this.state.isAuthModalOpen}
              onRequestClose={this.closeAuthModal}
              style={{
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
                <div className={homeStyles['auth-modal-body']}>
                  <label htmlFor="auth-email">
                    Email:
                    <input
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
                            value: event.target.value.replace(/@.*/, atDomain =>
                              atDomain.toLowerCase(),
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
                          this.state.isPasswordRevealed ? 'text' : 'password'
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
                    type="button"
                    className={homeStyles['auth-submit-btn']}
                    disabled={this.state.isUserInfoSaving}
                    onClick={this.handleLogIn}
                  >
                    {this.state.isUserInfoSaving ? 'Logging in...' : 'Log In'}
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
                    Don&apos;t have an account?{' '}
                    <button
                      type="button"
                      onClick={() => this.switchAuthTab('signup')}
                    >
                      Sign Up
                    </button>
                  </div>
                </div>
              )}

              {/* Sign Up form */}
              {this.state.authModalTab === 'signup' && (
                <div className={homeStyles['auth-modal-body']}>
                  <label htmlFor="auth-signup-email">
                    Email:
                    <input
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
                            value: event.target.value.replace(/@.*/, atDomain =>
                              atDomain.toLowerCase(),
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
                          this.state.isPasswordRevealed ? 'text' : 'password'
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
                    I&apos;m willing to testify at a hearing, which can be done
                    by phone.
                  </label>
                  <button
                    type="button"
                    className={homeStyles['auth-submit-btn']}
                    disabled={this.state.isUserInfoSaving}
                    onClick={this.handleSignUp}
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
                </div>
              )}
            </Modal>

            {this.isLoggedIn() ? (
              <form
                onSubmit={async e => {
                  e.preventDefault();

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
                  axios
                    .post(
                      '/submit',
                      objectToFormData({
                        ...this.getPerSubmissionState(),
                        attachmentData: this.state.attachmentData,
                        CreateDate: new Date(
                          this.state.CreateDate,
                        ).toISOString(),
                      }),
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
                      document.querySelector(`.${homeStyles.root}`).scrollTo({
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
                      this.setState(state => ({
                        attachmentData: [],
                        submissions: [submission].concat(state.submissions),
                        allPlateResults: [],
                        plateThumbnailsByKey: {},
                        vehicleInfoComponent: null,
                        violationSummaryComponent: null,
                        reportDescription: '',
                      }));
                      this.setLicensePlate({ plate: '', licenseState: 'NY' });
                      this.setCoords({
                        latitude: defaultLatitude,
                        longitude: defaultLongitude,
                      });
                      Home.notifySuccess(
                        <React.Fragment>
                          <p>Thanks for your submission!</p>
                          <p>
                            Your information has been submitted to Reported. It
                            may take up to 24 hours for it to be processed.
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
                      this.saveStateToLocalStorage();
                    });
                }}
              >
                <fieldset disabled={this.state.isSubmitting}>
                  <FileReaderInput
                    multiple
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

                  <div
                    style={{
                      clear: 'both',
                      display: 'flex',
                      flexWrap: 'wrap',
                    }}
                  >
                    {this.state.attachmentData.map(attachmentFile => {
                      const { name } = attachmentFile;
                      const ext = fileExtension(name);
                      const isImg = isImage({ ext });
                      const src = getBlobUrl(attachmentFile);

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
                          <a
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {isImg ? (
                              <img src={src} alt={name} />
                            ) : (
                              /* eslint-disable-next-line jsx-a11y/media-has-caption */
                              <video src={src} alt={name} />
                            )}
                          </a>

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
                            onClick={() => {
                              this.setState(state => ({
                                attachmentData: state.attachmentData.filter(
                                  file => file.name !== name,
                                ),
                              }));
                            }}
                          >
                            <span role="img" aria-label="Delete photo/video">
                              ❌
                            </span>
                          </button>

                          {isImg && (
                            <button
                              type="button"
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                padding: 0,
                                margin: '1px',
                                background: 'white',
                              }}
                              onClick={() =>
                                this.handlePlatePickerClick(attachmentFile)
                              }
                              disabled={this.state.platePickerLoading}
                            >
                              {this.state.platePickerLoading ? (
                                <CircularProgress size="1em" />
                              ) : (
                                <span
                                  role="img"
                                  aria-label="Pick license plate from photo"
                                >
                                  🔍
                                </span>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

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

                  <label htmlFor="plate">
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
                          required
                          type="search"
                          value={this.state.plate}
                          name="plate"
                          list="plateSuggestions"
                          autoComplete="off"
                          ref={this.plateRef}
                          placeholder={this.state.allPlateResults[0]?.plate.toUpperCase()}
                          onChange={event => {
                            const plate = event.target.value.toUpperCase();
                            const matchedResult =
                              this.state.allPlateResults.find(
                                r => r.plate.toUpperCase() === plate,
                              );
                            const licenseState = matchedResult
                              ? getLicenseStateFromPlateResult(matchedResult)
                              : null;
                            this.setLicensePlate({ plate, licenseState });
                          }}
                        />
                        <datalist id="plateSuggestions">
                          {this.state.allPlateResults.map(result => (
                            <option value={result.plate.toUpperCase()} />
                          ))}
                        </datalist>
                        <select
                          style={{
                            marginTop: '0.5rem',
                          }}
                          value={this.state.licenseState}
                          name="licenseState"
                          onChange={event => {
                            this.setLicensePlate({
                              plate: this.state.plate,
                              licenseState: event.target.value,
                            });
                          }}
                        >
                          {Object.entries(usStateNames)
                            .sort(([, name1], [, name2]) =>
                              name1
                                .toUpperCase()
                                .localeCompare(name2.toUpperCase()),
                            )
                            .map(([abbr, name]) => (
                              <option key={abbr} value={abbr}>
                                {name}
                              </option>
                            ))}
                        </select>
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
                      {this.props.typeofcomplaintValues.map(typeofcomplaint => (
                        <option key={typeofcomplaint} value={typeofcomplaint}>
                          {typeofcomplaint}
                        </option>
                      ))}
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
                        .split(', ')
                        .slice(0, 2)
                        .join(', ')}
                    </button>
                  </label>

                  <Modal
                    parentSelector={() =>
                      document.querySelector(`.${homeStyles.root}`) ||
                      document.body
                    }
                    isOpen={this.state.isMapOpen}
                    onRequestClose={() => this.setState({ isMapOpen: false })}
                    style={{
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
                        this.setCoords({
                          latitude,
                          longitude,
                          addressProvenance: '(manually set)',
                        });
                      }}
                      onSearchBoxMounted={ref => {
                        this.searchBox = ref;
                      }}
                      onPlacesChanged={() => {
                        const places = this.searchBox.getPlaces();

                        const nextMarkers = places.map(place => ({
                          position: place.geometry.location,
                        }));
                        const { latitude, longitude } =
                          nextMarkers.length > 0
                            ? {
                                latitude: nextMarkers[0].position.lat(),
                                longitude: nextMarkers[0].position.lng(),
                              }
                            : this.state;

                        this.setCoords({
                          latitude,
                          longitude,
                          addressProvenance: '(manually set)',
                        });
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
                      onClick={() => this.setState({ isMapOpen: false })}
                      style={{
                        float: 'right',
                      }}
                    >
                      Close
                    </button>
                  </Modal>

                  <PlatePickerModal
                    isOpen={this.state.platePickerModalOpen}
                    results={this.state.platePickerResults}
                    onSelectPlate={({ plate, licenseState }) => {
                      this.setLicensePlate({ plate, licenseState });
                      this.setState({ platePickerModalOpen: false });
                    }}
                    onClose={() =>
                      this.setState({ platePickerModalOpen: false })
                    }
                  />

                  <label htmlFor="CreateDate">
                    When:{' '}
                    <input
                      required
                      type="datetime-local"
                      value={this.state.CreateDate}
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

                  <label htmlFor="can_be_shared_publicly">
                    <input
                      id="can_be_shared_publicly"
                      type="checkbox"
                      checked={this.state.can_be_shared_publicly}
                      name="can_be_shared_publicly"
                      onChange={this.handleInputChange}
                    />{' '}
                    Allow the photos/videos, description, category, and location
                    to be publicly displayed
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
                    <button
                      type="submit"
                      disabled={
                        this.state.isSubmitting || !this.state.coordsAreInNyc
                      }
                      style={{
                        width: '100%',
                      }}
                    >
                      Submit
                    </button>
                  )}
                </fieldset>
              </form>
            ) : (
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

            <br />

            {this.isLoggedIn() && (
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
                  <>
                    {this.state.hasLoadedPreviousSubmissions &&
                      !this.state.isPreviousSubmissionsLoading && (
                        <label
                          htmlFor="isLoadPreviousSubmissionsEnabled"
                          style={{ display: 'block', marginBottom: '1rem' }}
                        >
                          <input
                            id="isLoadPreviousSubmissionsEnabled"
                            type="checkbox"
                            checked={
                              this.state.isLoadPreviousSubmissionsEnabled
                            }
                            name="isLoadPreviousSubmissionsEnabled"
                            onChange={this.handleInputChange}
                          />{' '}
                          Load previous submissions immediately next time
                        </label>
                      )}
                    <PreviousSubmissionsList
                      submissions={this.state.submissions}
                      onDeleteSubmission={this.onDeleteSubmission}
                      isLoading={this.state.isPreviousSubmissionsLoading}
                      hasLoadedPreviousSubmissions={
                        this.state.hasLoadedPreviousSubmissions
                      }
                    />
                  </>
                )}
              </details>
            )}

            <div style={{ float: 'right' }}>
              <a
                href="/electricitibikes"
                style={{
                  background: 'black',
                  border: '1em solid black',
                  borderRadius: '2em',
                  textDecoration: 'none',
                }}
              >
                <span role="img" aria-label="high voltage">
                  ⚡
                </span>
              </a>
            </div>
          </main>
        </div>
      </Dropzone>
    );
  }
}

Home.propTypes = {
  typeofcomplaintValues: PropTypes.arrayOf(PropTypes.string).isRequired,
  boroughBoundariesFeatureCollection: PropTypes.object.isRequired,
  localStorageKey: PropTypes.string,
};

Home.defaultProps = {
  localStorageKey: undefined,
};

const MyMapComponentPure = props => {
  const {
    position,
    onRef,
    onCenterChanged,
    onSearchBoxMounted,
    onPlacesChanged,
  } = props;

  return (
    <GoogleMap
      defaultZoom={16}
      center={position}
      ref={onRef}
      onCenterChanged={onCenterChanged}
      options={{ mapTypeControl: false, gestureHandling: 'greedy' }}
    >
      <Marker position={position} />
      <SearchBox
        ref={onSearchBoxMounted}
        controlPosition={window.google.maps.ControlPosition.TOP_LEFT}
        onPlacesChanged={onPlacesChanged}
        bounds={{
          east: -73.700272,
          north: 40.915256,
          south: 40.496044,
          west: -74.255735,
        }}
      >
        <input
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
        />
      </SearchBox>
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
  onSearchBoxMounted: PropTypes.func.isRequired,
  onPlacesChanged: PropTypes.func.isRequired,
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

export default withStyles(
  marx,
  homeStyles,
  toastifyStyles,
)(withLocalStorage(Home));
