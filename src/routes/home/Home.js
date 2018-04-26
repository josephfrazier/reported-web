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
import GithubCorner from 'react-github-corner';
import NewWindow from 'react-new-window/umd/react-new-window'; // https://github.com/rmariuzzo/react-new-window/pull/10

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
const urls = new Map(); // using Map instead of WeakMap because the keys are primitive strings, which WeakMap doesn't allow
const getImageUrl = imageBytes => {
  if (urls.has(imageBytes)) {
    return urls.get(imageBytes);
  }
  const imageUrl = `data:;base64,${imageBytes}`;
  urls.set(imageBytes, imageUrl);
  return imageUrl;
};

const geolocate = () =>
  promisedLocation().catch(async () => {
    const { data } = await axios.get('https://ipapi.co/json');
    const { latitude, longitude } = data;
    return { coords: { latitude, longitude } };
  });

const jsDateToCreateDate = jsDate => jsDate.toISOString().replace(/\..*/g, '');

class Home extends React.Component {
  state = {
    isUserInfoOpen: true,
    isUserInfoSaving: false,
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
    // TODO also consider using IndexedDB (via e.g. localForage) to store File/Blob objects directly
    // instead of having to convert back from base64
    // If this is done, we can use a WeakMap instead of a Map in getImageUrl() above.
    //
    // See https://github.com/localForage/localForage/issues/40
    // See https://github.com/localForage/localForage/issues/380
    imageBytess: [],

    isSubmitting: false,
    isLoadingImages: false,
    isLoadingPlate: false,
  };

  componentDidMount() {
    // if there's no images or a time couldn't be extracted, just use now
    if (this.state.imageBytess.length === 0 || !this.state.CreateDate) {
      this.setCreateDate({ millisecondsSinceEpoch: Date.now() });
    }
    geolocate().then(({ coords }) => {
      // if there's no images or a location couldn't be extracted, just use here
      if (
        this.state.imageBytess.length === 0 ||
        (this.state.latitude === defaultLatitude &&
          this.state.longitude === defaultLongitude)
      ) {
        this.setCoords(coords);
      }
    });
    this.forceUpdate(); // force "Create/Edit User" fields to render persisted value after load
  }

  setCoords = ({ latitude, longitude }) => {
    this.setState({ latitude, longitude });
    debouncedReverseGeocode({ latitude, longitude }).then(data => {
      this.setState({ formatted_address: data.results[0].formatted_address });
    });
  };

  setCreateDate = ({ millisecondsSinceEpoch }) => {
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
  handleChange = async (_, results) => {
    this.setState({ isLoadingImages: true });

    const images = await Promise.all(
      results.map(async (result, i) => {
        const [, file] = result;
        try {
          console.time(`blobToBase64String ${i}`); // eslint-disable-line no-console
          const imageBytes = await blobUtil.blobToBase64String(file); // eslint-disable-line no-await-in-loop
          console.timeEnd(`blobToBase64String ${i}`); // eslint-disable-line no-console
          return { imageBytes };
        } catch (err) {
          console.error(`Error: ${err.message}`);
          return {};
        }
      }),
    );

    this.setState({
      imageBytess: images.map(({ imageBytes }) => imageBytes),
      isLoadingImages: false,
    });

    for (const { imageBytes } of images) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          this.extractPlate({ imageBytes }),
          this.extractLocationDate({ imageBytes }),
        ]);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
    }
  };

  extractLocationDate = ({ imageBytes }) => {
    console.time(`Buffer.from(imageBytes, 'base64')`); // eslint-disable-line no-console
    const imageBuffer = Buffer.from(imageBytes, 'base64');
    console.timeEnd(`Buffer.from(imageBytes, 'base64')`); // eslint-disable-line no-console

    console.time(`ExifImage`); // eslint-disable-line no-console
    return promisify(ExifImage)({ image: imageBuffer }).then(exifData => {
      console.timeEnd(`ExifImage`); // eslint-disable-line no-console
      return Promise.all([
        this.extractLocation({ exifData }),
        this.extractDate({ exifData }),
      ]);
    });
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
  imagePlates = new Map(); // using Map instead of WeakMap because the keys are primitive strings, which WeakMap doesn't allow
  // adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
  extractPlate = async ({ imageBytes }) => {
    console.time('extractPlate'); // eslint-disable-line no-console
    this.setState({ isLoadingPlate: true });

    try {
      if (this.imagePlates.has(imageBytes)) {
        const plate = this.imagePlates.get(imageBytes);
        this.setLicensePlate({ plate });
        return;
      }
      const country = 'us'; // {String} Defines the training data used by OpenALPR. \"us\" analyzes North-American style plates. \"eu\" analyzes European-style plates. This field is required if using the \"plate\" task You may use multiple datasets by using commas between the country codes. For example, 'au,auwide' would analyze using both the Australian plate styles. A full list of supported country codes can be found here https://github.com/openalpr/openalpr/tree/master/runtime_data/config

      const opts = {
        recognizeVehicle: 0, // {Integer} If set to 1, the vehicle will also be recognized in the image This requires an additional credit per request
        state: 'ny', // {String} Corresponds to a US state or EU country code used by OpenALPR pattern recognition. For example, using \"md\" matches US plates against the Maryland plate patterns. Using \"fr\" matches European plates against the French plate patterns.
        returnImage: 0, // {Integer} If set to 1, the image you uploaded will be encoded in base64 and sent back along with the response
        topn: 10, // {Integer} The number of results you would like to be returned for plate candidates and vehicle classifications
        prewarp: '', // {String} Prewarp configuration is used to calibrate the analyses for the angle of a particular camera. More information is available here http://doc.openalpr.com/accuracy_improvements.html#calibration
      };

      const { data } = await axios.post('/openalpr', {
        imageBytes,
        country,
        opts,
      });
      const { plate } = data.results[0];
      this.imagePlates.set(imageBytes, plate);
      this.setLicensePlate({ plate });
    } catch (err) {
      throw err;
    } finally {
      this.setState({ isLoadingPlate: false });
      console.timeEnd('extractPlate'); // eslint-disable-line no-console
    }
  };

  extractDate = ({ exifData }) => {
    const { exif: { CreateDate } } = exifData;
    const millisecondsSinceEpoch = new Date(
      CreateDate.replace(':', '/').replace(':', '/'),
    ).getTime();

    this.setCreateDate({ millisecondsSinceEpoch });
  };

  extractLocation = ({ exifData }) => {
    const { gps } = exifData;
    this.setCoords(this.coordsFromExifGps({ gps }));
  };

  // adapted from http://danielhindrikes.se/web/get-coordinates-from-photo-with-javascript/
  coordsFromExifGps = ({ gps }) => {
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
  };

  render() {
    return (
      <div className={s.root}>
        <GithubCorner
          href="https://github.com/josephfrazier/Reported-Web"
          bannerColor="black"
        />
        <div className={s.container}>
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
                  .catch(err => {
                    window.alert(`Error: ${err.response.data.error.message}`);
                  })
                  .catch(err => {
                    console.error(err);
                  })
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
                  value={this.state.email}
                  name="email"
                  onChange={this.handleInputChange}
                />
              </label>

              <label>
                Password:{' '}
                <div style={{ display: 'flex' }}>
                  <input
                    required
                    onInvalid={() => this.setState({ isUserInfoOpen: true })}
                    type={this.state.isPasswordRevealed ? 'text' : 'password'}
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
                        .catch(err => {
                          window.alert(
                            `Error: ${err.response.data.error.message}`,
                          );
                        })
                        .catch(err => {
                          console.error(err);
                        });
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
            onSubmit={e => {
              e.preventDefault();
              this.setState({
                isSubmitting: true,
              });
              axios
                .post('/submit', {
                  ...this.state,
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
                .catch(err => {
                  window.alert(`Error: ${err.response.data.error.message}`);
                })
                .catch(err => {
                  console.error(err);
                })
                .then(() => {
                  this.setState({
                    isSubmitting: false,
                  });
                });
            }}
          >
            {/*
            TODO accept videos too
            Probably use a separate input, since that looks better on Android Chrome
            */}
            <FileReaderInput
              accept="image/*"
              multiple
              as="buffer"
              onChange={this.handleChange}
            >
              <button type="button">Select/Take a picture</button>
              &nbsp; {this.state.isLoadingImages && 'Loading...'}
            </FileReaderInput>

            {this.state.popupImageIndex > -1 && (
              <NewWindow
                name="_blank"
                onUnload={() => this.setState({ popupImageIndex: -1 })}
              >
                <img
                  alt={`#${this.state.popupImageIndex + 1}`}
                  src={getImageUrl(
                    this.state.imageBytess[this.state.popupImageIndex],
                    // TODO detect orientation from EXIF and use CSS transform?
                    // See https://gist.github.com/nezed/d536ccdace84c6f2ef13da47a8fd6bdb#file-exif-image-orientation-css-transform-fix-js-L13-L22
                  )}
                  style={{
                    width: '100vw',
                    height: '100vh',
                    objectFit: 'contain',
                  }}
                />
              </NewWindow>
            )}

            <ol>
              {this.state.imageBytess.map((imageBytes, i) => (
                <li key={imageBytes}>
                  <button
                    type="button"
                    style={{
                      margin: '1px',
                    }}
                    onClick={() => {
                      this.setState({ popupImageIndex: i });
                    }}
                  >
                    View
                  </button>

                  <button
                    type="button"
                    style={{
                      margin: '1px',
                      color: 'red', // Ubuntu Chrome shows black otherwise
                    }}
                    onClick={() => {
                      this.setState({
                        imageBytess: this.state.imageBytess.filter(
                          bytes => bytes !== imageBytes,
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
                      this.extractLocationDate({ imageBytes });
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
                      this.extractPlate({ imageBytes });
                    }}
                    disabled={this.state.isLoadingPlate}
                  >
                    {this.state.isLoadingPlate ? 'Reading...' : 'Read plate'}
                  </button>
                </li>
              ))}
            </ol>

            <label>
              License/Medallion: {this.state.isLoadingPlate && 'Loading...'}
              <div style={{ display: 'flex' }}>
                <input
                  required
                  type="text"
                  value={this.state.plate}
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
                    this.setCreateDate({
                      millisecondsSinceEpoch: Date.now(),
                    });
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
              Allow the photo, description, category, and location to be
              publicly displayed
            </label>

            <button type="submit" disabled={this.state.isSubmitting}>
              {this.state.isSubmitting ? 'Submitting...' : 'Submit'}
            </button>

            <div style={{ float: 'right' }}>
              <a href="https://twitter.com/@Reported_NYC">
                <button
                  type="button"
                  style={{
                    background: '#1da1f2',
                    borderColor: '#1da1f2',
                  }}
                >
                  @Reported_NYC
                </button>
              </a>
            </div>
          </form>
        </div>
      </div>
    );
  }
}

const MyMapComponent = compose(
  withProps({
    googleMapURL: `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=3.exp&libraries=geometry,drawing,places`,
    loadingElement: <div style={{ height: `100%` }} />,
    containerElement: <div style={{ height: `400px` }} />,
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
