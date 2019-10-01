/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import path from 'path';
import assert from 'assert';
import express from 'express';
import forceSsl from 'force-ssl-heroku';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import nodeFetch from 'node-fetch';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';
import OpenalprApi from 'openalpr_api';
import Parse from 'parse/node';
import fileType from 'file-type-es5';
import sharp from 'sharp';
import axios from 'axios';
import multer from 'multer';
import stringify from 'json-stringify-safe';
import DelayedResponse from 'http-delayed-response';

import { isImage, isVideo } from './isImage.js';
import { validateLocation, processValidation } from './geoclient.js';
import { submit_311_illegal_parking_report } from './311.js'; // eslint-disable-line camelcase

import App from './components/App';
import Html from './components/Html';
import { ErrorPageWithoutStyle } from './routes/error/ErrorPage';
import errorPageStyle from './routes/error/ErrorPage.css';
import createFetch from './createFetch';
import router from './router';
// import assets from './asset-manifest.json'; // eslint-disable-line import/no-unresolved
import chunks from './chunk-manifest.json'; // eslint-disable-line import/no-unresolved
import config from './config';

require('dotenv').config();

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
  // send entire app down. Process manager will restart it
  process.exit(1);
});

const {
  PARSE_APP_ID,
  PARSE_JAVASCRIPT_KEY,
  PARSE_MASTER_KEY,
  PARSE_SERVER_URL,
  HEROKU_RELEASE_VERSION,
  OPENALPR_SECRET_KEY,
} = process.env;

require('heroku-self-ping')(config.api.serverUrl, {
  verbose: true,
});

// http://docs.parseplatform.org/js/guide/#getting-started
Parse.initialize(PARSE_APP_ID, PARSE_JAVASCRIPT_KEY, PARSE_MASTER_KEY);
Parse.Cloud.useMasterKey();
Parse.serverURL = PARSE_SERVER_URL;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1000 * 1000, // 10MB
    files: 6,
  },
});
// Here's the logic for the above `limits`:
// * Back4App has a per-file limit of 10mb: https://docs.back4app.com/docs/faq-parse-back4app/can-i-store-files-larger-than-10-mb-can-i-pay-to-remove-this-limit/
// * Up to 6 files can be included with each submission to Back4App:
//   * photoData0
//   * photoData1
//   * photoData2
//   * videoData0
//   * videoData1
//   * videoData2

//
// Tell any CSS tooling (such as Material UI) to use all vendor prefixes if the
// user agent is not known.
// -----------------------------------------------------------------------------
global.navigator = global.navigator || {};
global.navigator.userAgent = global.navigator.userAgent || 'all';

const app = express();
app.use(compression());
app.use(forceSsl);

//
// If you are using proxy from external machine, you can set TRUST_PROXY env
// Default is to trust proxy headers only from loopback interface.
// -----------------------------------------------------------------------------
app.set('trust proxy', config.trustProxy);

//
// Register Node.js middleware
// -----------------------------------------------------------------------------
app.use(express.static(path.resolve(__dirname, 'public')));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '80mb' }));
// attachments are no longer sent as base64 JSON, but bodyParser still tries to parse non-JSON bodies, so this 80mb `limit` needs to be here to avoid errors

const handlePromiseRejection = res => error => {
  console.error({ error });
  res.status(500).json(JSON.parse(stringify({ error })));
};

async function logIn({ email, password }) {
  // adapted from http://docs.parseplatform.org/js/guide/#signing-up
  const user = new Parse.User();
  const username = email;
  const fields = {
    username,
    email,
    password,
  };
  user.set(fields);

  return user
    .signUp(null)
    .catch(() => Parse.User.logIn(username, password))
    .then(userAgain => {
      console.info({ user: userAgain });
      if (!userAgain.get('emailVerified')) {
        userAgain.set({ email }); // reset email to trigger a verification email
        userAgain.save(null, {
          // sessionToken must be manually passed in:
          // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
          sessionToken: userAgain.get('sessionToken'),
        });
        const message = `We just sent you an email with a link to confirm your address, please find and click that.`;
        throw { message }; // eslint-disable-line no-throw-literal
      }
      return userAgain;
    });
}

app.use('/api/logIn', (req, res) => {
  logIn(req.body)
    .then(user => res.json(user))
    .catch(handlePromiseRejection(res));
});

async function saveUser({
  email,
  password,
  FirstName,
  LastName,
  Phone,
  testify,
}) {
  // make sure all required fields are present
  Object.entries({
    FirstName,
    LastName,
    Phone,
  }).forEach(([key, value]) => {
    if (!value) {
      throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
    }
  });

  const useremail = email;
  const fields = {
    useremail,
    FirstName,
    LastName,
    Phone,
    testify,
  };

  return logIn({ email, password }).then(userAgain => {
    userAgain.set(fields);
    return userAgain.save(null, {
      // sessionToken must be manually passed in:
      // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
      sessionToken: userAgain.get('sessionToken'),
    });
  });
}

app.use('/saveUser', (req, res) => {
  saveUser(req.body)
    .then(user => res.json(user))
    .catch(handlePromiseRejection(res));
});

app.use('/api/categories', (req, res) => {
  const Category = Parse.Object.extend('Category');
  const query = new Parse.Query(Category);
  query
    .find()
    .then(results => {
      const categories = results.map(({ id, attributes }) => ({
        objectId: id,
        ...attributes,
      }));
      res.json({ categories });
    })
    .catch(handlePromiseRejection(res));
});

app.use('/api/validate_location', (req, res) => {
  const { lat, long } = req.body;
  validateLocation({ lat, long })
    .then(body => res.json(body))
    .catch(handlePromiseRejection(res));
});

app.use('/api/process_validation', (req, res) => {
  const { lat, long } = req.body;
  processValidation({ lat, long })
    .then(body => res.json(body))
    .catch(handlePromiseRejection(res));
});

async function getSubmissions(req) {
  return saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');
    const query = new Parse.Query(Submission);
    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users
    query.equalTo('Username', user.get('username'));
    query.descending('timeofreport');
    query.limit(Number.MAX_SAFE_INTEGER);
    return query.find();
  });
}

app.use('/submissions', (req, res) => {
  getSubmissions(req)
    .then(results => {
      const submissions = results.map(({ id, attributes }) => ({
        objectId: id,
        ...attributes,
      }));
      return submissions;
    })
    .then(submissions => {
      res.json({ submissions });
    })
    .catch(handlePromiseRejection(res));
});

app.use('/api/deleteSubmission', (req, res) => {
  const { objectId } = req.body;
  getSubmissions(req)
    .then(submissions => {
      const submission = submissions.find(sub => sub.id === objectId);
      assert(submission); // TODO make it obvious that this is necessary
      return submission.destroy().then(() => {
        res.json({ objectId });
      });
    })
    .catch(handlePromiseRejection(res));
});

function srlookup({ reqnumber }) {
  return axios.get(`http://www1.nyc.gov/apps/311api/srlookup/${reqnumber}`);
}

app.get('/srlookup/:reqnumber', (req, res) => {
  const { reqnumber } = req.params;

  srlookup({ reqnumber })
    .then(({ data }) => {
      res.json(data);
    })
    .catch(handlePromiseRejection(res));
});

app.use('/requestPasswordReset', (req, res) => {
  const { email } = req.body;

  // http://docs.parseplatform.org/js/guide/#resetting-passwords
  Parse.User.requestPasswordReset(email)
    .then(() => res.end())
    .catch(handlePromiseRejection(res));
});

function orientImageBuffer({ attachmentBuffer }) {
  console.time(`orientImageBuffer`); // eslint-disable-line no-console
  return sharp(attachmentBuffer)
    .rotate()
    .toBuffer()
    .catch(() => attachmentBuffer)
    .then(buffer => Buffer.from(buffer))
    .then(buffer => {
      console.timeEnd(`orientImageBuffer`); // eslint-disable-line no-console
      return buffer;
    });
}

app.use('/submit', (req, res) => {
  // Call upload.array directly to intercept errors and respond with JSON, see the following:
  // https://github.com/expressjs/multer/tree/80ee2f52432cc0c81c93b03c6b0b448af1f626e5#error-handling
  upload.array('attachmentData[]')(req, res, error => {
    if (error) {
      // Make error.message enumerable so it gets sent to the client
      const { message } = error;
      handlePromiseRejection(res)({ ...error, message });
      return;
    }

    const {
      email,
      password,
      FirstName,
      LastName,
      Phone,
      testify: testifyString,

      plate,
      licenseState,
      typeofuser,
      typeofreport = 'complaint',
      typeofcomplaint,
      reportDescription,
      can_be_shared_publicly: can_be_shared_publiclyString, // eslint-disable-line camelcase
      latitude: latitudeString,
      longitude: longitudeString,
      formatted_address, // eslint-disable-line camelcase
      CreateDate,
    } = req.body;

    const testify = testifyString === 'true';
    const can_be_shared_publicly = can_be_shared_publiclyString === 'true'; // eslint-disable-line camelcase
    const latitude = Number(latitudeString);
    const longitude = Number(longitudeString);

    const attachmentData = req.files;

    const timeofreport = new Date(CreateDate);
    const timeofreported = timeofreport;

    saveUser({
      email,
      password,
      FirstName,
      LastName,
      Phone,
      testify,
    })
      .then(async user => {
        // make sure all required fields are present
        Object.entries({
          plate,
          licenseState,
          typeofuser,
          typeofcomplaint,
          latitude,
          longitude,
          CreateDate,
        }).forEach(([key, value]) => {
          if (!value) {
            throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
          }
        });

        const Submission = Parse.Object.extend('submission');
        const submission = new Submission();
        submission.set({
          user,

          FirstName,
          LastName,
          Phone,
          testify,

          Username: email,

          typeofreport,
          selectedReport: typeofreport === 'complaint' ? 1 : 0,
          colorTaxi: 'Black', // see https://reportedcab.slack.com/messages/C852Q265V/p1528474895000562
          medallionNo: plate,
          license: plate, // https://github.com/josephfrazier/Reported-Web/issues/23
          state: licenseState, // https://github.com/josephfrazier/Reported-Web/issues/23
          typeofcomplaint,
          typeofuser: typeofuser.toLowerCase(),
          passenger: typeofuser.toLowerCase() === 'passenger',
          locationNumber: 1,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          latitude1: latitude,
          longitude1: longitude,
          location: new Parse.GeoPoint({ latitude, longitude }),
          loc1_address: formatted_address,
          timeofreport,
          timeofreported,
          reportDescription,
          can_be_shared_publicly,
          status: 0,
          operating_system: 'web',
          version_number: Number(HEROKU_RELEASE_VERSION.slice(1)),
          reqnumber: 'N/A until submitted to 311',
        });
        submission.setACL(new Parse.ACL(user));

        // upload attachments
        // http://docs.parseplatform.org/js/guide/#creating-a-parsefile

        const attachmentsWithFormats = attachmentData.map(
          ({ buffer: attachmentBuffer }) => ({
            attachmentBuffer,
            ext: fileType(attachmentBuffer).ext,
          }),
        );

        const images = attachmentsWithFormats.filter(isImage);
        const videos = attachmentsWithFormats.filter(isVideo);

        await Promise.all([
          ...images
            .slice(0, 3)
            .map(async ({ attachmentBuffer, ext }, index) => {
              const attachmentBufferRotated = await orientImageBuffer({
                attachmentBuffer,
              });

              const key = `photoData${index}`;
              const file = new Parse.File(`${key}.${ext}`, [
                ...attachmentBufferRotated,
              ]);
              await file.save();
              submission.set(key, file);
            }),
          ...videos
            .slice(0, 3)
            .map(async ({ attachmentBuffer, ext }, index) => {
              const key = `videoData${index}`;
              const file = new Parse.File(`${key}.${ext}`, [
                ...attachmentBuffer,
              ]);
              await file.save();
              submission.set(key, file.url());
            }),
        ]);
        return submission.save(null);
      })
      .then(submission => {
        // Unwrap encoded Date objects into ISO strings
        // before: { __type: 'Date', iso: '2018-05-26T23:17:22.000Z' }
        // after: '2018-05-26T23:17:22.000Z'
        const submissionValue = submission.toJSON();
        submissionValue.timeofreport = submissionValue.timeofreport.iso;
        submissionValue.timeofreported = submissionValue.timeofreported.iso;

        console.info({ submission: submissionValue });

        res.json({ submission: submissionValue });
      })
      .catch(handlePromiseRejection(res));
  });
});

// adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
app.use('/openalpr', upload.single('attachmentFile'), (req, res) => {
  const country = 'us';
  const opts = {
    recognizeVehicle: 1,
    state: 'ny',
    returnImage: 0,
    topn: 10,
    prewarp: '',
  };

  const attachmentBuffer = req.file.buffer;
  const api = new OpenalprApi.DefaultApi();

  const secretKey = OPENALPR_SECRET_KEY; // {String} The secret key used to authenticate your account. You can view your secret key by visiting https://cloud.openalpr.com/

  orientImageBuffer({ attachmentBuffer })
    .then(buffer => buffer.toString('base64'))
    .then(attachmentBytesRotated => {
      console.time(`/openalpr recognizeBytes`); // eslint-disable-line no-console
      return new Promise((resolve, reject) => {
        api.recognizeBytes(
          attachmentBytesRotated,
          secretKey,
          country,
          opts,
          (error, data) => {
            console.timeEnd(`/openalpr recognizeBytes`); // eslint-disable-line no-console
            if (error) {
              reject(error);
            } else {
              resolve(data);
            }
          },
        );
      });
    })
    .then(data => res.json(data))
    .catch(handlePromiseRejection(res));
});

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
app.use('/getVehicleType/:licensePlate/:licenseState?', (req, res) => {
  const { licensePlate = 'GNS7685', licenseState = 'NY' } = req.params;
  const url = `https://findbyplate.com/US/${licenseState}/${licensePlate}/`;

  console.time(url); // eslint-disable-line no-console
  axios
    .get(url)
    .then(({ data }) => {
      console.timeEnd(url); // eslint-disable-line no-console
      const vehicleSummary = data
        .match(/<h2 class="vehicle-modal">(.+?)</s)[1]
        .trim();
      const [vehicleYear, vehicleMake, vehicleModel] = vehicleSummary.split(
        ' ',
        3,
      );
      let vehicleBody;

      try {
        vehicleBody = data
          .match(/<div class="cell" data-title="BodyClass">(.+?)</s)[1]
          .trim();
      } catch (err) {
        console.error('no vehicle body');
      }

      // if (vehicleYear === 'Try Members Area') {
      //   const message = 'not found';
      //   throw { message, licensePlate, licenseState }; // eslint-disable-line no-throw-literal
      // }

      res.json({
        result: {
          vehicleYear,
          vehicleMake,
          vehicleModel,
          vehicleBody,
          licensePlate,
          licenseState,
        },
      });
    })
    .catch(handlePromiseRejection(res));
});

app.use('/api/submit_311_illegal_parking_report', (req, res) => {
  const delayed = new DelayedResponse(req, res);
  delayed.json();
  const delayedCallback = delayed.start();
  submit_311_illegal_parking_report(req.body)
    .then(result => {
      delayedCallback(null, { result });
    })
    .catch(handlePromiseRejection(res));
});

//
// Register server-side rendering middleware
// -----------------------------------------------------------------------------
app.get('*', async (req, res, next) => {
  try {
    const css = new Set();

    // Enables critical path CSS rendering
    // https://github.com/kriasoft/isomorphic-style-loader
    const insertCss = (...styles) => {
      // eslint-disable-next-line no-underscore-dangle
      styles.forEach(style => css.add(style._getCss()));
    };

    // Universal HTTP client
    const fetch = createFetch(nodeFetch, {
      baseUrl: config.api.serverUrl,
      cookie: req.headers.cookie,
    });

    // Global (context) variables that can be easily accessed from any React component
    // https://facebook.github.io/react/docs/context.html
    const context = {
      insertCss,
      fetch,
      // The twins below are wild, be careful!
      pathname: req.path,
      query: req.query,
    };

    const route = await router.resolve(context);

    if (route.redirect) {
      res.redirect(route.status || 302, route.redirect);
      return;
    }

    const data = { ...route };
    data.children = ReactDOM.renderToString(
      <App context={context}>{route.component}</App>,
    );
    data.styles = [{ id: 'css', cssText: [...css].join('') }];

    const scripts = new Set();
    const addChunk = chunk => {
      if (chunks[chunk]) {
        chunks[chunk].forEach(asset => scripts.add(asset));
      } else if (__DEV__) {
        throw new Error(`Chunk with name '${chunk}' cannot be found`);
      }
    };
    addChunk('client');
    if (route.chunk) addChunk(route.chunk);
    if (route.chunks) route.chunks.forEach(addChunk);

    data.scripts = Array.from(scripts);
    data.app = {
      apiUrl: config.api.clientUrl,
    };

    const html = ReactDOM.renderToStaticMarkup(<Html {...data} />);
    res.status(route.status || 200);
    res.send(`<!doctype html>${html}`);
  } catch (err) {
    next(err);
  }
});

//
// Error handling
// -----------------------------------------------------------------------------
const pe = new PrettyError();
pe.skipNodeFiles();
pe.skipPackage('express');

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(pe.render(err));
  const html = ReactDOM.renderToStaticMarkup(
    <Html
      title="Internal Server Error"
      description={err.message}
      styles={[{ id: 'css', cssText: errorPageStyle._getCss() }]} // eslint-disable-line no-underscore-dangle
    >
      {ReactDOM.renderToString(<ErrorPageWithoutStyle error={err} />)}
    </Html>,
  );
  res.status(err.status || 500);
  res.send(`<!doctype html>${html}`);
});

//
// Launch the server
// -----------------------------------------------------------------------------
const promise = Promise.resolve();
if (!module.hot) {
  promise.then(() => {
    app.listen(config.port, () => {
      console.info(`The server is running at http://localhost:${config.port}/`);
    });
  });
}

//
// Hot Module Replacement
// -----------------------------------------------------------------------------
if (module.hot) {
  app.hot = module.hot;
  module.hot.accept('./router');
}

export default app;
