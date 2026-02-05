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
import axios from 'axios';
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
import omit from 'object.omit';
import objectToFormData from 'object-to-formdata';
import usStateNames from 'datasets-us-states-abbr-names';
import fileExtension from 'file-extension';
import diceware from 'diceware-generator';
import wordlist from 'diceware-wordlist-en-eff';
import Modal from 'react-modal';
import Dropzone from '@josephfrazier/react-dropzone';
import { ToastContainer } from 'react-toastify';
import toastifyStyles from 'react-toastify/dist/ReactToastify.css';
import { zip } from 'zip-array';
import { CSVLink } from 'react-csv';
import capitalize from 'capitalize';
import CircularProgress from '@mui/material/CircularProgress';

import marx from 'marx-css/css/marx.css';
import homeStyles from './Home.css';

import SubmissionDetails from '../../components/SubmissionDetails.js';
import { isImage } from '../../isImage.js';
import vehicleTypeUrl from '../../vehicleTypeUrl.js';
import {
  blobToBuffer,
  getBlobUrl,
  extractPlate,
  extractLocation,
  extractDate,
} from '../../utils/fileProcessing.js';
import {
  geolocate,
  debouncedProcessValidation,
  validateNycBoundary,
} from '../../utils/geolocation.js';
import { debouncedGetVehicleType } from '../../utils/plateService.js';
import {
  notifySuccess,
  notifyInfo,
  notifyWarning,
  notifyError,
} from '../../utils/notifications.js';

usStateNames.DC = 'District of Columbia';

const GOOGLE_MAPS_API_KEY = 'AIzaSyDlwm2ykA0ohTXeVepQYvkcmdjz2M2CKEI';

const objectMap = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v], i) => [k, fn(v, k, i)]));

const debouncedSaveStateToLocalStorage = debounce(self => {
  self.saveStateToLocalStorage();
}, 500);

const defaultLatitude = 40.7128;
const defaultLongitude = -74.006;

const jsDateToCreateDate = jsDate =>
  jsDate.toISOString().replace(/:\d\d\..*/g, '');

class Home extends React.Component {
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
      isUserInfoOpen: true,
      isMapOpen: false,
    };

    const initialStatePerSession = {
      attachmentData: [],

      isAlprLoading: false,
      isPasswordRevealed: false,
      isUserInfoSaving: false,
      isSubmitting: false,
      plateSuggestions: [],
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
    const validationResult = validateNycBoundary({
      latitude,
      longitude,
      boroughBoundariesFeatureCollection: this.props
        .boroughBoundariesFeatureCollection,
    });

    if (!validationResult.coordsAreInNyc) {
      this.setState({
        formatted_address: validationResult.errorMessage,
        coordsAreInNyc: false,
      });
      notifyError(validationResult.errorMessage);

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
      vehicleInfoComponent: plate ? (
        `Looking up make/model for ${plate} in ${usStateNames[licenseState]}`
      ) : (
        <br />
      ),
    });

    const now = Date.now();
    if (
      this.state.submissions.some(submission => {
        const timeDifference =
          now - new Date(submission.timeofreport).valueOf();
        const thirtyDaysInMilliseconds = 30 * 24 * 60 * 60 * 1000;
        const olderThanThirtyDays =
          timeDifference / thirtyDaysInMilliseconds > 1;
        if (olderThanThirtyDays) {
          return false;
        }

        return (
          (submission.license === plate || submission.medallionNo === plate) &&
          submission.state === licenseState
        );
      })
    ) {
      notifyWarning(
        <p>
          You have already submitted a report for {plate} in {licenseState}, are
          you sure you want to submit another?
        </p>,
      );
    }

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
                  href={vehicleTypeUrl({ licensePlate: plate, licenseState })}
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
  };

  getVehicleMakeLogoUrl = function getVehicleMakeLogoUrl({ vehicleMake }) {
    if (vehicleMake.toLowerCase() === 'nissan') {
      return 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Nissan_2020_logo.svg/287px-Nissan_2020_logo.svg.png';
    }
    if (vehicleMake.toLowerCase() === 'honda') {
      return 'https://upload.wikimedia.org/wikipedia/commons/3/38/Honda.svg';
    }
    return `https://img.logo.dev/${vehicleMake}.com?token=pk_dUmX4e3CQxqMliLAmNRIqA`;
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
              notifyWarning(
                <React.Fragment>
                  <p>
                    File #{index + 1} is too big, over 20MB, please remove it
                    and select a smaller one
                  </p>
                </React.Fragment>,
              );
            }

            // eslint-disable-next-line no-await-in-loop
            const {
              attachmentBuffer,
              attachmentArrayBuffer,
            } = await blobToBuffer({
              attachmentFile,
            });

            // eslint-disable-next-line no-await-in-loop
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
                  this.setState({
                    plateSuggestions: result.plateSuggestions,
                  });
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

        const missingValuesString = rejected.map(v => v.reason).join(', ');
        const hasMultipleAttachments = this.state.attachmentData.length > 1;
        const fileCopy = hasMultipleAttachments ? 'the files.' : 'the file.';

        notifyWarning(
          <React.Fragment>
            <p>
              Could not extract the {missingValuesString} from {fileCopy} Please
              enter/confirm any missing values manually.
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

    this.setState(
      {
        [name]: value,
      },
      () => debouncedSaveStateToLocalStorage(this),
    );
  };

  handleAxiosError = error =>
    Promise.reject(error)
      .catch(err => {
        notifyError(`Error: ${err.response.data.error.message}`);
      })
      .catch(err => {
        console.error(err);
      });

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
                      document.querySelector(`.${homeStyles.root}`).scrollTo({
                        top: 100,
                        left: 100,
                        behavior: 'smooth',
                      });
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
                              notifyInfo(message);
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
                    I&apos;m willing to testify at a hearing, which can be done
                    by phone.
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
                  notifyError('Please provide the location of the incident');
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
                      plateSuggestions: [],
                      reportDescription: '',
                    }));
                    this.setLicensePlate({ plate: '', licenseState: 'NY' });
                    notifySuccess(
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
                  <button type="button">
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

                <label htmlFor="isReverseGeocodingEnabled">
                  <input
                    type="checkbox"
                    checked={this.state.isReverseGeocodingEnabled}
                    name="isReverseGeocodingEnabled"
                    onChange={this.handleInputChange}
                  />{' '}
                  Automatically read addresses from pictures/videos
                </label>

                <label htmlFor="plate">
                  License/Medallion:
                  {this.state.isAlprLoading && <CircularProgress size="1em" />}
                  <input
                    required
                    type="search"
                    value={this.state.plate}
                    name="plate"
                    list="plateSuggestions"
                    autoComplete="off"
                    ref={this.plateRef}
                    placeholder={this.state.plateSuggestions[0]}
                    onChange={event => {
                      this.setLicensePlate({
                        plate: event.target.value.toUpperCase(),
                      });
                    }}
                  />
                  <datalist id="plateSuggestions">
                    {this.state.plateSuggestions.map(plateSuggestion => (
                      <option value={plateSuggestion} />
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
                        name1.toUpperCase().localeCompare(name2.toUpperCase()),
                      )
                      .map(([abbr, name]) => (
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
                          notifyError(err.message);
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
                    autoComplete="off"
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
                Previous Submissions (
                {this.state.submissions.length > 0
                  ? this.state.submissions.length
                  : 'click to load'}
                )
              </summary>

              {this.state.submissions.length === 0 ? (
                'Loading submissions...'
              ) : (
                <>
                  <CSVLink
                    separator="	"
                    data={this.state.submissions.map(submission =>
                      objectMap(submission, value =>
                        typeof value === 'object'
                          ? JSON.stringify(value)
                          : value,
                      ),
                    )}
                  >
                    Download as CSV
                  </CSVLink>
                  <ul>
                    {this.state.submissions.map(submission => (
                      <li key={submission.objectId}>
                        <SubmissionDetails
                          submission={submission}
                          onDeleteSubmission={this.onDeleteSubmission}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>

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
