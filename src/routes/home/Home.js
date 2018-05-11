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
import Loadable from 'react-loadable';
import humanizeString from 'humanize-string';

import marx from 'marx-css/css/marx.css';
import s from './Home.css';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

const debouncedReverseGeocode = debounce(async ({ latitude, longitude }) => {
  const { data } = await axios.get(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`,
  );
  return data;
}, 500);

const typeofuserValues = ['Cyclist', 'Walker', 'Passenger'];
const typeofcomplaintValues = [
  'Blocked the bike lane',
  'Blocked the crosswalk',
  'Honked horn (no emergency)',
  'Failed to yield to pedestrian',
  'Drove aggressively',
  'Was on a cell phone while driving',
  'Refused to pick me up',
  'Was courteous, kind or polite',
  'Went above and beyond to help',
];

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

const jsDateToCreateDate = jsDate => jsDate.toISOString().replace(/\..*/g, '');

const initialStatePersistent = {
  isUserInfoOpen: true,
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
  typeofuser: typeofuserValues[0],
  typeofcomplaint: typeofcomplaintValues[0],
  reportDescription: '',
  can_be_shared_publicly: false,
  latitude: defaultLatitude,
  longitude: defaultLongitude,
  formatted_address: '',
  CreateDate: jsDateToCreateDate(new Date()),
};

const initialStatePerSession = {
  attachmentData: [],

  isUserInfoSaving: false,
  isSubmitting: false,
  isLoadingPlate: false,
  submissions: [],
};

const initialState = {
  ...initialStatePersistent,
  ...initialStatePerSession,
};

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
  const { exif: { CreateDate } } = exifData;
  const millisecondsSinceEpoch = new Date(
    CreateDate.replace(':', '/').replace(':', '/'),
  ).getTime();

  return millisecondsSinceEpoch;
}

// TODO make this work with videos. Options include:
// * https://github.com/mceachen/exiftool-vendored.js
//   (recommended at https://www.sno.phy.queensu.ca/~phil/exiftool/#related_prog)
// * https://github.com/Sobesednik/node-exiftool
//   with https://github.com/Sobesednik/dist-exiftool
async function extractLocationDate({ attachmentFile }) {
  console.time(`blobUtil.blobToArrayBuffer(attachmentFile)`); // eslint-disable-line no-console
  const attachmentArrayBuffer = await blobUtil.blobToArrayBuffer(
    attachmentFile,
  );
  console.timeEnd(`blobUtil.blobToArrayBuffer(attachmentFile)`); // eslint-disable-line no-console

  console.time(`Buffer.from(attachmentArrayBuffer)`); // eslint-disable-line no-console
  const attachmentBuffer = Buffer.from(attachmentArrayBuffer);
  console.timeEnd(`Buffer.from(attachmentArrayBuffer)`); // eslint-disable-line no-console

  console.time(`ExifImage`); // eslint-disable-line no-console
  return promisify(ExifImage)({ image: attachmentBuffer }).then(exifData => {
    console.timeEnd(`ExifImage`); // eslint-disable-line no-console
    return Promise.all([
      extractLocation({ exifData }),
      extractDate({ exifData }),
    ]);
  });
}

function handleAxiosError(error) {
  return Promise.reject(error)
    .catch(err => {
      window.alert(`Error: ${err.response.data.error.message}`);
    })
    .catch(err => {
      console.error(err);
    });
}

class Home extends React.Component {
  static defaultProps = {
    stateFilterKeys: Object.keys(initialStatePersistent),
  };
  state = initialState;

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
    this.forceUpdate(); // force "Create/Edit User" fields to render persisted value after load
  }

  setLocationDate = ([coords, millisecondsSinceEpoch]) => {
    this.setCoords(coords);
    this.setCreateDate(millisecondsSinceEpoch);
  };

  setCoords = ({ latitude, longitude }) => {
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

  setLicensePlate = ({ plate }) => {
    this.setState({ plate });
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
          this.extractPlate({ attachmentFile }).then(this.setLicensePlate),
          extractLocationDate({ attachmentFile }).then(this.setLocationDate),
        ]);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
    }
  };

  handleInputChange = event => {
    const { target } = event;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    const { name } = target;

    this.setState({
      [name]: value,
    });
  };

  // adapted from https://www.bignerdranch.com/blog/dont-over-react/
  attachmentPlates = new WeakMap();
  // adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
  extractPlate = async ({ attachmentFile }) => {
    console.time('extractPlate'); // eslint-disable-line no-console
    this.setState({ isLoadingPlate: true });

    try {
      if (this.attachmentPlates.has(attachmentFile)) {
        const plate = this.attachmentPlates.get(attachmentFile);
        return { plate };
      }

      console.time(`blobToBase64String ${attachmentFile.name}`); // eslint-disable-line no-console
      const attachmentBytes = await blobUtil.blobToBase64String(attachmentFile); // eslint-disable-line no-await-in-loop
      console.timeEnd(`blobToBase64String ${attachmentFile.name}`); // eslint-disable-line no-console

      // TODO don't hit server for videos, or make them work

      const country = 'us'; // {String} Defines the training data used by OpenALPR. \"us\" analyzes North-American style plates. \"eu\" analyzes European-style plates. This field is required if using the \"plate\" task You may use multiple datasets by using commas between the country codes. For example, 'au,auwide' would analyze using both the Australian plate styles. A full list of supported country codes can be found here https://github.com/openalpr/openalpr/tree/master/runtime_data/config

      const opts = {
        recognizeVehicle: 0, // {Integer} If set to 1, the vehicle will also be recognized in the image This requires an additional credit per request
        state: 'ny', // {String} Corresponds to a US state or EU country code used by OpenALPR pattern recognition. For example, using \"md\" matches US plates against the Maryland plate patterns. Using \"fr\" matches European plates against the French plate patterns.
        returnImage: 0, // {Integer} If set to 1, the image you uploaded will be encoded in base64 and sent back along with the response
        topn: 10, // {Integer} The number of results you would like to be returned for plate candidates and vehicle classifications
        prewarp: '', // {String} Prewarp configuration is used to calibrate the analyses for the angle of a particular camera. More information is available here http://doc.openalpr.com/accuracy_improvements.html#calibration
      };

      const { data } = await axios.post('/openalpr', {
        attachmentBytes,
        country,
        opts,
      });
      const { plate } = data.results[0];
      this.attachmentPlates.set(attachmentFile, plate);
      return { plate };
    } catch (err) {
      throw err;
    } finally {
      this.setState({ isLoadingPlate: false });
      console.timeEnd('extractPlate'); // eslint-disable-line no-console
    }
  };

  render() {
    return (
      <div className={s.root}>
        <div className={s.container}>
          <main>
            {/* TODO use tabbed interface instead of toggling <details> ? */}
            <details
              open={this.state.isUserInfoOpen}
              onToggle={evt => {
                this.setState({
                  isUserInfoOpen: evt.target.open,
                });
              }}
            >
              <summary
                style={{
                  outline: 'none',
                }}
              >
                Create/Edit User (click to expand)
              </summary>

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
                    .catch(handleAxiosError)
                    .then(() => {
                      this.setState({ isUserInfoSaving: false });
                    });
                }}
              >
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
                      onInvalid={() => this.setState({ isUserInfoOpen: true })}
                      type={this.state.isPasswordRevealed ? 'text' : 'password'}
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
                            window.alert(message);
                          })
                          .catch(handleAxiosError);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </label>

                <label>
                  First Name:{' '}
                  <input
                    required
                    onInvalid={() => this.setState({ isUserInfoOpen: true })}
                    type="text"
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

                <button type="submit" disabled={this.state.isUserInfoSaving}>
                  {this.state.isUserInfoSaving ? 'Saving...' : 'Save'}
                </button>
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
                  .post('/submit', {
                    ...this.state,
                    attachmentDataBase64: await Promise.all(
                      this.state.attachmentData.map(attachmentFile =>
                        blobUtil.blobToBase64String(attachmentFile),
                      ),
                    ),
                    CreateDate: new Date(this.state.CreateDate).toISOString(),
                  })
                  .then(({ data }) => {
                    console.info(
                      `submitted successfully. Returned data: ${JSON.stringify(
                        data,
                        null,
                        2,
                      )}`,
                    );
                    window.prompt(
                      'Submitted! objectId:',
                      data.submission.objectId,
                    );
                  })
                  .catch(handleAxiosError)
                  .then(() => {
                    this.setState({
                      isSubmitting: false,
                    });
                  });
              }}
            >
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

              <ol
                style={{
                  clear: 'both',
                }}
              >
                {this.state.attachmentData.map(attachmentFile => (
                  <li key={attachmentFile.name}>
                    <a
                      href={getBlobUrl(attachmentFile)}
                      target="_blank"
                      rel="noopener"
                    >
                      <button
                        type="button"
                        style={{
                          margin: '1px',
                        }}
                      >
                        View
                      </button>
                    </a>

                    <button
                      type="button"
                      style={{
                        margin: '1px',
                        color: 'red', // Ubuntu Chrome shows black otherwise
                      }}
                      onClick={() => {
                        this.setState({
                          attachmentData: this.state.attachmentData.filter(
                            file => file.name !== attachmentFile.name,
                          ),
                        });
                      }}
                    >
                      ❌
                    </button>

                    <button
                      type="button"
                      style={{
                        margin: '1px',
                      }}
                      onClick={() => {
                        extractLocationDate({ attachmentFile }).then(
                          this.setLocationDate,
                        );
                      }}
                    >
                      Read location and time
                    </button>

                    <button
                      type="button"
                      style={{
                        margin: '1px',
                      }}
                      onClick={() => {
                        this.extractPlate({ attachmentFile }).then(
                          this.setLicensePlate,
                        );
                      }}
                      disabled={this.state.isLoadingPlate}
                    >
                      {this.state.isLoadingPlate ? 'Reading...' : 'Read plate'}
                    </button>
                  </li>
                ))}
              </ol>

              <label>
                License/Medallion:
                <div style={{ display: 'flex' }}>
                  <input
                    required
                    type="text"
                    disabled={this.state.isLoadingPlate}
                    value={
                      this.state.isLoadingPlate
                        ? 'Reading...'
                        : this.state.plate
                    }
                    onChange={event => {
                      this.setLicensePlate({ plate: event.target.value });
                    }}
                  />
                  &nbsp;
                  <button
                    type="button"
                    onClick={() => {
                      this.setLicensePlate({ plate: '' });
                    }}
                  >
                    Clear
                  </button>
                </div>
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
                  {typeofcomplaintValues.map(typeofcomplaint => (
                    <option key={typeofcomplaint} value={typeofcomplaint}>
                      {typeofcomplaint}
                    </option>
                  ))}
                </select>
              </label>

              <details>
                <summary
                  style={{
                    outline: 'none',
                  }}
                >
                  Where: (click to edit)
                  <button
                    type="button"
                    style={{
                      float: 'right',
                    }}
                    onClick={() => {
                      geolocate()
                        .then(({ coords }) => {
                          this.setCoords(coords);
                        })
                        .catch(err => {
                          window.alert(err.message);
                          console.error(err);
                        });
                    }}
                  >
                    Here
                  </button>
                  <br />
                  {this.state.formatted_address
                    .split(', ')
                    .slice(0, 2)
                    .join(', ')}
                </summary>

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
              </details>

              <label>
                When:{' '}
                <div style={{ display: 'flex' }}>
                  <input
                    required
                    type="datetime-local"
                    value={this.state.CreateDate}
                    name="CreateDate"
                    onChange={this.handleInputChange}
                  />
                  &nbsp;
                  <button
                    type="button"
                    onClick={() => {
                      this.setCreateDate(Date.now());
                    }}
                  >
                    Now
                  </button>
                </div>
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
                Allow the photos/videos, description, category, and location to
                be publicly displayed
              </label>

              <button type="submit" disabled={this.state.isSubmitting}>
                {this.state.isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
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
                  .catch(handleAxiosError);
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

// eslint-disable-next-line react/no-multi-comp
class SubmissionDetails extends React.Component {
  state = {
    isDetailsOpen: false,
  };

  render() {
    const {
      reqnumber,
      medallionNo,
      typeofcomplaint,
      timeofreport,

      photoData0,
      photoData1,
      photoData2,

      videoData0,
      videoData1,
      videoData2,
    } = this.props.submission;

    const humanTimeString = new Date(timeofreport).toLocaleString();

    const ImagesAndVideos = () => {
      const images = [photoData0, photoData1, photoData2]
        .filter(item => !!item)
        .map((photoData, i) => {
          const { url } = photoData;
          return (
            <a href={url} target="_blank">
              <img key={url} src={url} alt={`#${i}`} />
            </a>
          );
        });

      const videos = [videoData0, videoData1, videoData2]
        .filter(item => !!item)
        .map((videoData, i) => {
          const url = videoData;
          return (
            <a href={url} target="_blank">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video key={url} src={url} alt={`#${i}`} />
            </a>
          );
        });

      return (
        <React.Fragment>
          {images}
          {videos}
        </React.Fragment>
      );
    };

    const LoadableServiceRequestStatus = Loadable({
      loader: () =>
        axios.get(`/srlookup/${reqnumber}`).then(({ data }) => () => {
          const { threeOneOneSRLookupResponse } = data;
          const items = Object.entries(threeOneOneSRLookupResponse[0]).map(
            ([key, value]) => (
              <React.Fragment key={key}>
                <dt>{humanizeString(key)}:</dt>
                <dd>
                  {key.endsWith('Date') ? new Date(value).toString() : value}
                </dd>
              </React.Fragment>
            ),
          );
          return <dl>{items}</dl>;
        }),
      loading: () => 'Loading Service Request Status...',
    });

    return (
      <details
        open={this.state.isDetailsOpen}
        onToggle={evt => {
          this.setState({
            isDetailsOpen: evt.target.open,
          });
        }}
      >
        <summary>
          {medallionNo} {typeofcomplaint} on {humanTimeString}
        </summary>

        {this.state.isDetailsOpen && (
          <React.Fragment>
            <ImagesAndVideos />

            {!reqnumber.startsWith('N/A') && (
              <div>
                <LoadableServiceRequestStatus />
              </div>
            )}
          </React.Fragment>
        )}
      </details>
    );
  }
}

SubmissionDetails.propTypes = {
  submission: PropTypes.shape({
    reqnumber: PropTypes.string,
    medallionNo: PropTypes.string,
    typeofcomplaint: PropTypes.string,
    timeofreport: PropTypes.string,

    photoData0: PropTypes.object,
    photoData1: PropTypes.object,
    photoData2: PropTypes.object,

    videoData0: PropTypes.string,
    videoData1: PropTypes.string,
    videoData2: PropTypes.string,
  }).isRequired,
};

const MyMapComponent = compose(
  withProps({
    googleMapURL: `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.exp&libraries=geometry,drawing,places`,
    loadingElement: <div style={{ height: `100%` }} />,
    containerElement: <div style={{ height: `75vh` }} />,
    mapElement: <div style={{ height: `100%` }} />,
  }),
  withScriptjs,
  withGoogleMap,
)(props => {
  const { position, onRef, onCenterChanged } = props;

  return (
    <GoogleMap
      defaultZoom={16}
      center={position}
      ref={onRef}
      onCenterChanged={onCenterChanged}
      options={{ gestureHandling: 'greedy' }}
    >
      <Marker position={position} />
      <SearchBox
        ref={props.onSearchBoxMounted}
        controlPosition={window.google.maps.ControlPosition.TOP_LEFT}
        onPlacesChanged={props.onPlacesChanged}
      >
        <input
          type="text"
          placeholder="Search..."
          style={{
            boxSizing: `border-box`,
            border: `1px solid transparent`,
            width: `240px`,
            height: `32px`,
            marginTop: `27px`,
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
});

export default withStyles(marx, s)(withLocalStorage(Home));
