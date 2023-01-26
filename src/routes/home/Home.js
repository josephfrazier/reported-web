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
import withStyles from 'isomorphic-style-loader/lib/withStyles';
import FileReaderInput from 'react-file-reader-input';
import blobUtil from 'blob-util';
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
import { SocialIcon } from 'react-social-icons';
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

import marx from 'marx-css/css/marx.css';
import s from './Home.css';

import SubmissionDetails from '../../components/SubmissionDetails.js';
import { isImage, isVideo } from '../../isImage.js';
import getNycTimezoneOffset from '../../timezone.js';

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
  500,
);

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
    return { coords: { latitude, longitude } };
  });

const jsDateToCreateDate = jsDate =>
  jsDate.toISOString().replace(/:\d\d\..*/g, '');

async function blobToBuffer({ attachmentFile }) {
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

async function extractLocation({ attachmentFile, attachmentArrayBuffer, ext }) {
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

    const {
      CreateDate,
      OffsetTimeDigitized,
    } = await exifr.parse(attachmentArrayBuffer, [
      'CreateDate',
      'OffsetTimeDigitized',
    ]);

    // console.log({ CreateDate, OffsetTimeDigitized });

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

  const buf = captureFrame(video);

  // unload video element, to prevent memory leaks
  video.pause();
  video.src = '';
  video.load();

  return buf;
}

class Home extends React.Component {
  // adapted from https://www.bignerdranch.com/blog/dont-over-react/
  attachmentPlates = new WeakMap();

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
      formatted_address: '',
      CreateDate: jsDateToCreateDate(new Date()),
    };

    const initialStatePersistent = {
      ...initialStatePerSubmission,
      isAlprEnabled: true,
      isUserInfoOpen: true,
      isMapOpen: false,
    };

    const initialStatePerSession = {
      attachmentData: [],

      isPasswordRevealed: false,
      isUserInfoSaving: false,
      isSubmitting: false,
      plateSuggestion: '',
      vehicleInfoComponent: <br />,
      submissions: [],
      addressProvenance: '',
    };

    const initialState = {
      ...initialStatePersistent,
      ...initialStatePerSession,
    };

    this.state = initialState;
    this.initialStatePerSubmission = initialStatePerSubmission;
    this.initialStatePersistent = initialStatePersistent;
    this.userFormSubmitRef = React.createRef();
    this.plateRef = React.createRef();
  }

  componentDidMount() {
    // if there's no attachments or a time couldn't be extracted, just use now
    if (this.state.attachmentData.length === 0 || !this.state.CreateDate) {
      this.setCreateDate({ millisecondsSinceEpoch: Date.now() });
    }
    geolocate().then(({ coords: { latitude, longitude } }) => {
      // if there's no attachments or a location couldn't be extracted, just use here
      if (
        this.state.attachmentData.length === 0 ||
        (this.state.latitude === defaultLatitude &&
          this.state.longitude === defaultLongitude)
      ) {
        this.setCoords({
          latitude,
          longitude,
          addressProvenance: '(from device)',
        });
      }
    });

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
    } else if (this.state.email) {
      this.loadPreviousSubmissions();
    }

    // Allow users to paste image data
    // adapted from https://github.com/charliewilco/react-gluejar/blob/b69d7cfa9d08bfb34d8eb6815e4b548528218883/src/index.js#L85
    window.addEventListener('paste', clipboardEvent => {
      const { items } = clipboardEvent.clipboardData;
      // [].map.call because `items` isn't an array
      const attachmentData = [].map
        .call(items, item => item.getAsFile())
        .filter(file => !!file);
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
  }

  onDeleteSubmission = ({ objectId }) => {
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
      });
  };

  getPerSubmissionState() {
    return omit(this.state, (val, key) =>
      Object.keys(this.initialStatePerSubmission).includes(key),
    );
  }

  getStateFilterKeys() {
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
    debouncedProcessValidation({ latitude, longitude }).then(data => {
      this.setState({
        formatted_address: data.google_response.results[0].formatted_address,
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
      vehicleInfoComponent: plate ? (
        `Looking up make/model for ${plate} in ${usStateNames[licenseState]}`
      ) : (
        <br />
      ),
    });

    debouncedGetVehicleType({ plate, licenseState })
      .then(({ data }) => {
        const {
          vehicleYear,
          vehicleMake,
          vehicleModel,
          vehicleBody,
        } = data.result;

        if (plate !== this.state.plate) {
          console.info('ignoring stale plate:', plate);
          return;
        }

        if (
          this.state.submissions.some(
            submission =>
              (submission.license === plate ||
                submission.medallionNo === plate) &&
              submission.state === licenseState,
          )
        ) {
          this.notifyWarning(
            <p>
              You have already submitted a report for {plate} in {licenseState},
              are you sure you want to submit another?
            </p>,
          );
        }

        this.setState({
          vehicleInfoComponent: (
            <React.Fragment>
              {plate} in {usStateNames[licenseState]}: {vehicleYear}{' '}
              {vehicleMake} {vehicleModel} ({vehicleBody})
              <img
                src={this.getVehicleMakeLogoUrl({ vehicleMake })}
                alt={`${vehicleMake} logo`}
                style={{
                  display: 'block',
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
              <a
                href="https://github.com/josephfrazier/Reported-Web/issues/295"
                target="_blank"
                rel="noopener noreferrer"
              >
                Could not look up make/model of {plate} in{' '}
                {usStateNames[licenseState]}, click here for details
              </a>
            ),
          });

          if (plate.match(/1\d\d\d\d\d\dC/)) {
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
  };

  getVehicleMakeLogoUrl = function getVehicleMakeLogoUrl({ vehicleMake }) {
    if (vehicleMake === 'Nissan') {
      return 'https://logo.clearbit.com/Nissanusa.com';
    }
    if (vehicleMake === 'Toyota') {
      return 'https://logo.clearbit.com/toyota.com';
    }
    if (vehicleMake === 'Honda') {
      return 'https://upload.wikimedia.org/wikipedia/commons/3/38/Honda.svg';
    }
    if (vehicleMake === 'Kia') {
      return 'https://logo.clearbit.com/kia.com';
    }
    return `https://logo.clearbit.com/${vehicleMake}.com`;
  };

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  handleAttachmentInput = async (_, results) => {
    const attachmentData = results.map(([, attachmentFile]) => attachmentFile);

    return this.handleAttachmentData({ attachmentData });
  };

  handleAttachmentData = async ({ attachmentData }) => {
    this.setState(state => ({
      attachmentData: state.attachmentData.concat(attachmentData),
    }));

    const arrs = await Promise.all(attachmentData.map(async attachmentFile => {
      // eslint-disable-next-line no-await-in-loop
      const { attachmentBuffer, attachmentArrayBuffer } = await blobToBuffer({
        attachmentFile,
      });

      // eslint-disable-next-line no-await-in-loop
      const { ext } = await FileType.fromBuffer(attachmentBuffer);

      return Promise.allSettled([
        this.extractPlate({ attachmentFile, attachmentBuffer, ext }),
        extractDate({
          attachmentFile,
          attachmentArrayBuffer,
          ext,
        }).then(this.setCreateDate),
        extractLocation({
          attachmentFile,
          attachmentArrayBuffer,
          ext,
        }).then(({ latitude, longitude }) => {
          this.setCoords({
            latitude,
            longitude,
            addressProvenance: '(extracted from picture/video)',
          });
        }),
      ]);
    }));

    const zipped = zip(...arrs);
    const failedExtractions = zipped.filter(results =>
      results.every(r => r.status === 'rejected'),
    );
    const failureReasons = failedExtractions.map(
      extraction => extraction[0].reason,
    );
    const missingValuesString = failureReasons.join(', ');

    const hasMultipleAttachments = attachmentData.length > 1;
    const fileCopy = hasMultipleAttachments
      ? 'one of the files, but they may have been found in other files.'
      : 'the file.';

    this.notifyWarning(
      <React.Fragment>
        <p>
          Could not extract the {missingValuesString} from {fileCopy} Please
          enter/confirm any missing values manually.
        </p>
      </React.Fragment>,
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

    this.setState(
      {
        [name]: value,
      },
      () => debouncedSaveStateToLocalStorage(this),
    );
  };

  extractPlate = async ({ attachmentFile, attachmentBuffer, ext }) => {
    console.time('extractPlate'); // eslint-disable-line no-console

    try {
      if (this.state.isAlprEnabled === false) {
        console.info('ALPR is disabled, skipping');
        return undefined;
      }

      // TODO does this actually do anything? the returned result isn't used anywhere
      if (this.attachmentPlates.has(attachmentFile)) {
        const result = this.attachmentPlates.get(attachmentFile);
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

      const formData = new window.FormData();
      formData.append('attachmentFile', attachmentBlob);
      const { data } = await axios.post('/platerecognizer', formData);
      const result = data.results[0];
      try {
        result.licenseState = result.region.code.split('-')[1].toUpperCase();
      } catch (err) {
        result.licenseState = null;
      }
      result.plate = result.plate.toUpperCase();
      if (
        this.state.plate === '' &&
        document.activeElement !== this.plateRef.current
      ) {
        this.setLicensePlate(result);
      }
      this.setState({
        plateSuggestion: result.plate,
      });
      this.attachmentPlates.set(attachmentFile, result);
      return result;
    } catch (err) {
      console.error(err.stack);

      throw 'license plate'; // eslint-disable-line no-throw-literal
    } finally {
      console.timeEnd('extractPlate'); // eslint-disable-line no-console
    }
  };

  handleAxiosError = error =>
    Promise.reject(error)
      .catch(err => {
        this.notifyError(`Error: ${err.response.data.error.message}`);
      })
      .catch(err => {
        console.error(err);
      });

  notifySuccess = notificationContent => toast.success(notificationContent);

  notifyInfo = notificationContent => toast.info(notificationContent);

  notifyWarning = notificationContent => toast.warn(notificationContent);

  notifyError = notificationContent => toast.error(notificationContent);

  loadPreviousSubmissions = () => {
    axios
      .post('/submissions', this.state)
      .then(({ data }) => {
        const { submissions } = data;
        this.setState({ submissions });
      })
      .catch(this.handleAxiosError);
  };

  render() {
    return (
      <Dropzone
        className={s.root}
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
        <div className={s.container}>
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

            {/* TODO use tabbed interface instead of toggling <details> ? */}
            <details
              open={this.state.isUserInfoOpen}
              onToggle={evt => {
                this.setState({
                  isUserInfoOpen: evt.target.open,
                });
              }}
            >
              <summary>Create/Edit User (click to expand)</summary>

              <form
                onSubmit={e => {
                  e.preventDefault();
                  this.setState({ isUserInfoSaving: true });
                  axios
                    .post('/saveUser', this.state)
                    .then(() => {
                      this.setState({ isUserInfoOpen: false });
                      window.scrollTo(0, 0);
                    })
                    .catch(this.handleAxiosError)
                    .then(() => {
                      this.setState({ isUserInfoSaving: false });
                    });
                }}
              >
                <fieldset disabled={this.state.isUserInfoSaving}>
                  <label htmlFor="email">
                    Email:{' '}
                    <input
                      required
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
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
                  <label htmlFor="password">
                    {
                      "Password (this is saved on your device, so use a password you don't use anywhere else): "
                    }
                    <div style={{ display: 'flex' }}>
                      <input
                        required
                        onInvalid={() =>
                          this.setState({ isUserInfoOpen: true })
                        }
                        type={
                          this.state.isPasswordRevealed ? 'text' : 'password'
                        }
                        autoComplete="current-password"
                        value={this.state.password}
                        name="password"
                        onChange={this.handleInputChange}
                      />
                      &nbsp;
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
                      &nbsp;
                      <button
                        type="button"
                        onClick={() => {
                          const { email } = this.state;
                          axios
                            .post('/requestPasswordReset', {
                              email,
                            })
                            .then(() => {
                              const message = `Please check ${email} to reset your password.`;
                              this.notifyInfo(message);
                            })
                            .catch(this.handleAxiosError);
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </label>
                  <button
                    type="button"
                    disabled={this.state.isUserInfoSaving}
                    onClick={async () => {
                      this.setState({ isUserInfoSaving: true });

                      const { data } = await axios
                        .post('/api/logIn', this.state)
                        .catch(err => {
                          this.handleAxiosError(err);
                          return { data: false };
                        });

                      this.setState({ isUserInfoSaving: false });

                      if (!data) {
                        return;
                      }

                      const { FirstName, LastName, Phone, testify } = data;

                      this.setState(
                        // If a new user clicks the button after filling all the fields,
                        // don't override them with empty data from the server.
                        state => ({
                          FirstName: FirstName || state.FirstName,
                          LastName: LastName || state.LastName,
                          Phone: Phone || state.Phone,
                          testify: testify || state.testify,
                        }),
                        () => {
                          this.saveStateToLocalStorage();
                          this.userFormSubmitRef.current.click();
                        },
                      );
                    }}
                  >
                    Sign Up / Log In
                  </button>
                  <br />
                  <br />
                  (If you cannot log in even after resetting your password,
                  email{' '}
                  <a href="mailto:reportedapp@gmail.com">
                    reportedapp@gmail.com
                  </a>
                  )
                  <label htmlFor="FirstName">
                    First Name:{' '}
                    <input
                      required
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="text"
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
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="text"
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
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="tel"
                      autoComplete="tel"
                      value={this.state.Phone}
                      name="Phone"
                      onChange={this.handleInputChange}
                    />
                  </label>
                  <label htmlFor="testify">
                    <input
                      type="checkbox"
                      checked={this.state.testify}
                      name="testify"
                      onChange={this.handleInputChange}
                    />{' '}
                    {
                      "I'm willing to testify at a hearing, which can be done by phone."
                    }
                  </label>
                  <button
                    type="submit"
                    disabled={this.state.isUserInfoSaving}
                    ref={this.userFormSubmitRef}
                  >
                    {this.state.isUserInfoSaving ? 'Saving...' : 'Save'}
                  </button>
                </fieldset>
              </form>
            </details>

            <form
              style={{
                display: this.state.isUserInfoOpen ? 'none' : 'block',
              }}
              onSubmit={async e => {
                e.preventDefault();

                if (
                  this.state.latitude === defaultLatitude &&
                  this.state.longitude === defaultLongitude
                ) {
                  this.notifyError(
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
                      CreateDate: new Date(this.state.CreateDate).toISOString(),
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
                    window.scrollTo(0, 0);
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
                      plateSuggestion: '',
                      reportDescription: '',
                    }));
                    this.setLicensePlate({ plate: '', licenseState: 'NY' });
                    this.notifySuccess(
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
                  .catch(this.handleAxiosError)
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
                  <button type="button">Add pictures/videos</button>
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
                        <a href={src} target="_blank" rel="noopener noreferrer">
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
                      </div>
                    );
                  })}
                </div>

                <label htmlFor="isAlprEnabled">
                  <input
                    type="checkbox"
                    checked={this.state.isAlprEnabled}
                    name="isAlprEnabled"
                    onChange={this.handleInputChange}
                  />{' '}
                  Automatically read license plates from pictures/videos
                </label>

                <label htmlFor="plate">
                  License/Medallion:
                  <input
                    required
                    type="search"
                    value={this.state.plate}
                    name="plate"
                    list="plateSuggestion"
                    ref={this.plateRef}
                    placeholder={this.state.plateSuggestion}
                    onChange={event => {
                      this.setLicensePlate({
                        plate: event.target.value.toUpperCase(),
                      });
                    }}
                  />
                  <datalist id="plateSuggestion">
                    {this.state.plateSuggestion && (
                      <option value={this.state.plateSuggestion} />
                    )}
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
                    {Object.entries(usStateNames).map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {this.state.vehicleInfoComponent}
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
                        .then(({ coords: { latitude, longitude } }) => {
                          this.setCoords({
                            latitude,
                            longitude,
                            addressProvenance: '(from device)',
                          });
                        })
                        .catch(err => {
                          this.notifyError(err.message);
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
                  />
                </label>

                <label htmlFor="can_be_shared_publicly">
                  <input
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
                    disabled={this.state.isSubmitting}
                    style={{
                      width: '100%',
                    }}
                  >
                    Submit
                  </button>
                )}
              </fieldset>
            </form>

            <br />

            <details
              onToggle={evt => {
                if (!evt.target.open) {
                  return;
                }
                this.loadPreviousSubmissions();
              }}
            >
              <summary>
                Previous Submissions
                {this.state.submissions.length > 0 &&
                  ` (${this.state.submissions.length})`}
              </summary>

              <ul>
                {this.state.submissions.length === 0
                  ? 'Loading submissions...'
                  : this.state.submissions.map(submission => (
                      <li key={submission.objectId}>
                        <SubmissionDetails
                          submission={submission}
                          onDeleteSubmission={this.onDeleteSubmission}
                        />
                      </li>
                    ))}
              </ul>
            </details>

            <div style={{ float: 'right' }}>
              <SocialIcon
                url="https://twitter.com/Reported_NYC"
                rel="noopener"
              />
              &nbsp;
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

export default withStyles(marx, s, toastifyStyles)(withLocalStorage(Home));
