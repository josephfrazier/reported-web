/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import promisify from 'util.promisify';
import React from 'react';
import PropTypes from 'prop-types';
import withStyles from 'isomorphic-style-loader/lib/withStyles';
import FileReaderInput from 'react-file-reader-input';
import blobUtil from 'blob-util';
import { ExifImage } from 'exif';
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
import fileType from 'file-type-es5';
import MP4Box from 'mp4box';
import execall from 'execall';
import captureFrame from 'capture-frame';
import pEvent from 'p-event';
import omit from 'object.omit';
import bufferToArrayBuffer from 'buffer-to-arraybuffer';
import objectToFormData from 'object-to-formdata';
import usStateNames from 'datasets-us-states-abbr-names';
import fileExtension from 'file-extension';
import niceware from 'niceware';
import Modal from 'react-modal';

import marx from 'marx-css/css/marx.css';
import s from './Home.css';

import SubmissionDetails from '../../components/SubmissionDetails.js';
import { isImage, isVideo } from '../../isImage.js';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

const debouncedReverseGeocode = debounce(async ({ latitude, longitude }) => {
  const { data } = await axios.get(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`,
  );
  return data;
}, 500);

const debouncedGetVehicleType = debounce(
  ({ plate, licenseState }) =>
    axios.get(`/getVehicleType/${plate}/${licenseState}`),
  500,
);

const typeofuserValues = ['Cyclist', 'Walker', 'Passenger'];

// copied from https://github.com/jeffrono/Reported-Android/blob/f92949014678f8847ef83a9e5746a9d97d4db87f/app/src/main/res/values/strings.xml#L105-L112
const boroughValues = [
  'Bronx',
  'Brooklyn',
  'Manhattan',
  'Queens',
  'Staten Island',
  'NOT WITHIN NEW YORK CITY',
];

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

// adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
function coordsFromExifGps({ gps }) {
  const lat = gps.GPSLatitude;
  const lng = gps.GPSLongitude;

  // Convert coordinates to WGS84 decimal
  const latRef = gps.GPSLatitudeRef || 'N';
  const lngRef = gps.GPSLongitudeRef || 'W';
  const latitude =
    (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === 'N' ? 1 : -1);
  const longitude =
    (lng[0] + lng[1] / 60 + lng[2] / 3600) * (lngRef === 'W' ? -1 : 1);

  return { latitude, longitude };
}

function extractLocation({ exifData }) {
  const { gps } = exifData;
  return coordsFromExifGps({ gps });
}

function extractDate({ exifData }) {
  const {
    exif: { CreateDate },
  } = exifData;
  const millisecondsSinceEpoch = new Date(
    CreateDate.replace(':', '/').replace(':', '/'),
  ).getTime();

  return millisecondsSinceEpoch;
}

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

async function extractLocationDate({ attachmentFile }) {
  const { attachmentBuffer, attachmentArrayBuffer } = await blobToBuffer({
    attachmentFile,
  });

  const { ext } = fileType(attachmentBuffer);
  if (isVideo({ ext })) {
    return extractLocationDateFromVideo({ attachmentArrayBuffer });
  } else if (!isImage({ ext })) {
    throw new Error(`${attachmentFile.name} is not an image/video`);
  }

  console.time(`ExifImage`); // eslint-disable-line no-console
  return promisify(ExifImage)({ image: attachmentBuffer }).then(exifData => {
    console.timeEnd(`ExifImage`); // eslint-disable-line no-console
    return Promise.all([
      extractLocation({ exifData }),
      extractDate({ exifData }),
    ]);
  });
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
  constructor(props) {
    super(props);

    const { typeofcomplaintValues } = props;

    const initialStatePerSubmission = {
      email: '',
      password: '',
      FirstName: '',
      LastName: '',
      Building: '',
      StreetName: '',
      Apt: '',
      Borough: boroughValues[0],
      Phone: '',
      testify: false,

      plate: '',
      licenseState: 'NY',
      typeofuser: typeofuserValues[0],
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
      isUserInfoOpen: true,
      isMapOpen: false,
    };

    const initialStatePerSession = {
      attachmentData: [],

      modalText: null,
      isPasswordRevealed: false,
      isUserInfoSaving: false,
      isSubmitting: false,
      plateSuggestion: '',
      vehicleInfoComponent: <br />,
      submissions: [],
    };

    const initialState = {
      ...initialStatePersistent,
      ...initialStatePerSession,
    };

    this.state = initialState;
    this.initialStatePerSubmission = initialStatePerSubmission;
    this.initialStatePersistent = initialStatePersistent;
    this.userFormSubmitRef = React.createRef();
  }

  componentDidMount() {
    // if there's no attachments or a time couldn't be extracted, just use now
    if (this.state.attachmentData.length === 0 || !this.state.CreateDate) {
      this.setCreateDate(Date.now());
    }
    geolocate().then(({ coords }) => {
      // if there's no attachments or a location couldn't be extracted, just use here
      if (
        this.state.attachmentData.length === 0 ||
        (this.state.latitude === defaultLatitude &&
          this.state.longitude === defaultLongitude)
      ) {
        this.setCoords(coords);
      }
    });

    // generate a random passphrase for first-time users and show it to them
    if (!this.state.password) {
      // async so that test snapshots don't change
      setTimeout(() => {
        this.setState({
          password: niceware.generatePassphrase(10).join(' '),
          isPasswordRevealed: true,
        });
      });
    }

    this.forceUpdate(); // force "Create/Edit User" fields to render persisted value after load
  }

  getStateFilterKeys() {
    return Object.keys(this.initialStatePersistent);
  }

  setLocationDate = ([coords, millisecondsSinceEpoch]) => {
    this.setCoords(coords);
    this.setCreateDate(millisecondsSinceEpoch);
  };

  setCoords = ({ latitude, longitude } = {}) => {
    if (!latitude || !longitude) {
      console.error('latitude and/or longitude is missing');
      return;
    }
    this.setState({
      latitude,
      longitude,
      formatted_address: 'Finding Address...',
    });
    debouncedReverseGeocode({ latitude, longitude }).then(data => {
      this.setState({ formatted_address: data.results[0].formatted_address });
    });
  };

  setCreateDate = millisecondsSinceEpoch => {
    // Adjust date to local time
    // https://stackoverflow.com/questions/674721/how-do-i-subtract-minutes-from-a-date-in-javascript
    const MS_PER_MINUTE = 60000;
    const offset = new Date().getTimezoneOffset();
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
        `Searching for ${plate} in ${usStateNames[licenseState]}`
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

        this.setState({
          vehicleInfoComponent: `${plate} in ${usStateNames[licenseState]}: ${vehicleYear} ${vehicleMake} ${vehicleModel} (${vehicleBody})` // prettier-ignore
        });
      })
      .catch(err => {
        console.error(err);
        if (plate) {
          this.setState({
            vehicleInfoComponent: `Could not find ${plate} in ${
              usStateNames[licenseState]
            }`,
          });
        }
      });
  };

  // adapted from https://github.com/ngokevin/react-file-reader-input/tree/f970257f271b8c3bba9d529ffdbfa4f4731e0799#usage
  handleAttachmentInput = async (_, results) => {
    const attachmentData = results.map(([, attachmentFile]) => attachmentFile);

    this.setState({
      attachmentData: this.state.attachmentData.concat(attachmentData),
    });

    for (const attachmentFile of attachmentData) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          this.extractPlate({ attachmentFile }),
          extractLocationDate({ attachmentFile }).then(this.setLocationDate),
        ]);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
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
      () => this.saveStateToLocalStorage(),
    );
  };

  // adapted from https://www.bignerdranch.com/blog/dont-over-react/
  attachmentPlates = new WeakMap();
  // adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
  extractPlate = async ({ attachmentFile }) => {
    console.time('extractPlate'); // eslint-disable-line no-console

    try {
      if (this.attachmentPlates.has(attachmentFile)) {
        const result = this.attachmentPlates.get(attachmentFile);
        return result;
      }

      let { attachmentBuffer } = await blobToBuffer({ attachmentFile });

      const { ext } = fileType(attachmentBuffer);
      if (isVideo({ ext })) {
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
      const { data } = await axios.post('/openalpr', formData);
      const result = data.results[0];
      result.licenseState = result.region.toUpperCase();
      if (this.state.plate === '') {
        this.setLicensePlate(result);
      }
      this.setState({
        plateSuggestion: result.plate,
      });
      this.attachmentPlates.set(attachmentFile, result);
      return result;
    } catch (err) {
      throw err;
    } finally {
      console.timeEnd('extractPlate'); // eslint-disable-line no-console
    }
  };

  handleAxiosError = error =>
    Promise.reject(error)
      .catch(err => {
        this.alert(`Error: ${err.response.data.error.message}`);
      })
      .catch(err => {
        console.error(err);
      });

  alert = modalText => this.setState({ modalText });
  closeAlert = () => this.setState({ modalText: null });

  render() {
    return (
      <div className={s.root}>
        <div className={s.container}>
          <main>
            <Modal
              isOpen={!!this.state.modalText}
              onRequestClose={this.closeAlert}
            >
              {this.state.modalText}
              <br />
              <button onClick={this.closeAlert}>Close</button>
            </Modal>

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
                  <label>
                    Email:{' '}
                    <input
                      required
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="email"
                      autoComplete="email"
                      value={this.state.email}
                      name="email"
                      onChange={this.handleInputChange}
                    />
                  </label>

                  <label>
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
                          this.setState({
                            isPasswordRevealed: !this.state.isPasswordRevealed,
                          });
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
                              this.alert(message);
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

                      const {
                        FirstName,
                        LastName,
                        Building,
                        StreetName,
                        Apt,
                        Borough,
                        Phone,
                        testify,
                      } = data;

                      this.setState(
                        // If a new user clicks the button after filling all the fields,
                        // don't override them with empty data from the server.
                        {
                          FirstName: FirstName || this.state.FirstName,
                          LastName: LastName || this.state.LastName,
                          Building: Building || this.state.Building,
                          StreetName: StreetName || this.state.StreetName,
                          Apt: Apt || this.state.Apt,
                          Borough: Borough || this.state.Borough,
                          Phone: Phone || this.state.Phone,
                          testify: testify || this.state.testify,
                        },
                        () => {
                          this.saveStateToLocalStorage();
                          this.userFormSubmitRef.current.click();
                        },
                      );
                    }}
                  >
                    Sign Up / Log In
                  </button>

                  <label>
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

                  <label>
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

                  <label>
                    Building Number:{' '}
                    <input
                      required
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="text"
                      value={this.state.Building}
                      name="Building"
                      onChange={this.handleInputChange}
                    />
                  </label>

                  <label>
                    Street Name:{' '}
                    <input
                      required
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type="text"
                      value={this.state.StreetName}
                      name="StreetName"
                      onChange={this.handleInputChange}
                    />
                  </label>

                  <label>
                    Apartment Number:{' '}
                    <input
                      type="text"
                      value={this.state.Apt}
                      name="Apt"
                      onChange={this.handleInputChange}
                    />
                  </label>

                  <label>
                    Borough:{' '}
                    <select
                      value={this.state.Borough}
                      name="Borough"
                      onChange={this.handleInputChange}
                    >
                      {boroughValues.map(borough => (
                        <option key={borough} value={borough}>
                          {borough}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
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

                  <label>
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
                this.setState({
                  isSubmitting: true,
                });
                axios
                  .post(
                    '/submit',
                    objectToFormData({
                      ...omit(this.state, (val, key) =>
                        Object.keys(this.initialStatePerSubmission).includes(
                          key,
                        ),
                      ),
                      attachmentData: this.state.attachmentData,
                      CreateDate: new Date(this.state.CreateDate).toISOString(),
                    }),
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
                    this.setState({
                      attachmentData: [],
                      submissions: [submission].concat(this.state.submissions),
                      plateSuggestion: '',
                      reportDescription: '',
                    });
                    this.setLicensePlate({ plate: '', licenseState: 'NY' });
                    this.alert(
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
                    });
                  });
              }}
            >
              <fieldset disabled={this.state.isSubmitting}>
                <FileReaderInput
                  accept="image/*"
                  multiple
                  as="buffer"
                  onChange={this.handleAttachmentInput}
                  style={{
                    float: 'left',
                    margin: '1px',
                  }}
                >
                  <button type="button">Add picture(s)</button>
                </FileReaderInput>

                <FileReaderInput
                  accept="video/*"
                  multiple
                  as="buffer"
                  onChange={this.handleAttachmentInput}
                  style={{
                    float: 'left',
                    margin: '1px',
                  }}
                >
                  <button type="button">Add video(s)</button>
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
                            this.setState({
                              attachmentData: this.state.attachmentData.filter(
                                file => file.name !== name,
                              ),
                            });
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

                <label>
                  License/Medallion:
                  <div style={{ display: 'flex' }}>
                    <input
                      required
                      type="text"
                      value={this.state.plate}
                      list="plateSuggestion"
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
                    &nbsp;
                    <select
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
                    &nbsp;
                    <button
                      type="button"
                      onClick={() => {
                        this.setLicensePlate({ plate: '', licenseState: 'NY' });
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  {this.state.vehicleInfoComponent}
                </label>

                <label>
                  I was:{' '}
                  <select
                    value={this.state.typeofuser}
                    name="typeofuser"
                    onChange={this.handleInputChange}
                  >
                    {typeofuserValues.map(typeofuser => (
                      <option key={typeofuser} value={typeofuser}>
                        {typeofuser}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
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

                <label>
                  Where:
                  <br />
                  <button
                    type="button"
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
                      this.setCoords({ latitude, longitude });
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
                      });
                    }}
                  />
                </Modal>

                <label>
                  When:{' '}
                  <input
                    required
                    type="datetime-local"
                    value={this.state.CreateDate}
                    name="CreateDate"
                    onChange={this.handleInputChange}
                  />
                </label>

                <label>
                  Description:{' '}
                  <textarea
                    value={this.state.reportDescription}
                    name="reportDescription"
                    onChange={this.handleInputChange}
                  />
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={this.state.can_be_shared_publicly}
                    name="can_be_shared_publicly"
                    onChange={this.handleInputChange}
                  />{' '}
                  Allow the photos/videos, description, category, and location
                  to be publicly displayed
                </label>

                <button type="submit" disabled={this.state.isSubmitting}>
                  {this.state.isSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </fieldset>
            </form>

            <br />

            <details
              onToggle={evt => {
                if (!evt.target.open) {
                  return;
                }
                axios
                  .post('/submissions', this.state)
                  .then(({ data }) => {
                    const { submissions } = data;
                    this.setState({ submissions });
                  })
                  .catch(this.handleAxiosError);
              }}
            >
              <summary>Previous Submissions</summary>

              <ul>
                {this.state.submissions.length === 0
                  ? 'Loading submissions...'
                  : this.state.submissions.map(submission => (
                      <li key={submission.objectId}>
                        <SubmissionDetails submission={submission} />
                      </li>
                    ))}
              </ul>
            </details>

            <div style={{ float: 'right' }}>
              <SocialIcon
                url="https://github.com/josephfrazier/Reported-Web"
                color="black"
                rel="noopener"
              />
              &nbsp;
              <SocialIcon
                url="https://twitter.com/Reported_NYC"
                rel="noopener"
              />
            </div>
          </main>
        </div>
      </div>
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
            fontSize: `14px`,
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
    containerElement: <div style={{ height: `100%` }} />,
    mapElement: <div style={{ height: `100%` }} />,
  }),
  withScriptjs,
  withGoogleMap,
)(MyMapComponentPure);

export default withStyles(marx, s)(withLocalStorage(Home));
