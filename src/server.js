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
import bodyParser from 'body-parser';
import nodeFetch from 'node-fetch';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';
import Parse from 'parse/node';
import FileType from 'file-type/browser';
import multer from 'multer';
import stringify from 'json-stringify-safe';
import StyleContext from 'isomorphic-style-loader/StyleContext';

import { isImage, isVideo } from './isImage.js';
import { validateLocation, processValidation } from './geoclient.js';
import getVehicleType from './getVehicleType.js';
import srlookup from './srlookup.js';

import App from './components/App.js';
import Html from './components/Html.js';
import { ErrorPageWithoutStyle } from './routes/error/ErrorPage.js';
import errorPageStyle from './routes/error/ErrorPage.css';
import createFetch from './createFetch.js';
import router from './router.js';
// import assets from './asset-manifest.json'; // eslint-disable-line import/no-unresolved
import chunks from './chunk-manifest.json'; // eslint-disable-line import/no-unresolved
import config from './config.js';
import readLicenseViaALPR from './alpr.js';

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
  PLATERECOGNIZER_TOKEN,
  PLATERECOGNIZER_TOKEN_TWO,
} = process.env;

require('heroku-self-ping').default(config.api.serverUrl, {
  verbose: true,
});

// http://docs.parseplatform.org/js/guide/#getting-started
Parse.initialize(PARSE_APP_ID, PARSE_JAVASCRIPT_KEY, PARSE_MASTER_KEY);
Parse.Cloud.useMasterKey();
Parse.serverURL = PARSE_SERVER_URL;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1000 * 1000, // just under 20MB, should match attachmentFile.size in Home.js
    files: 6,
  },
});
// Here's the logic for the above `limits`:
// * Back4App has a per-file limit of 20mb: https://www.back4app.com/pricing
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
if (!global.navigator) {
  global.navigator = {};
}
if (!global.navigator.userAgent) {
  Object.defineProperty(global.navigator, 'userAgent', {
    value: 'all',
    writable: true,
    configurable: true,
  });
}

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

    const usernameQuery = new Parse.Query(Submission);
    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users
    usernameQuery.equalTo('Username', user.get('username'));
    usernameQuery.descending('timeofreport');
    usernameQuery.limit(Number.MAX_SAFE_INTEGER);

    // Also search by "email" since submissions from iOS clients don't always have this set
    const emailQuery = new Parse.Query(Submission);
    emailQuery.equalTo('email', user.get('username'));
    emailQuery.descending('timeofreport');
    emailQuery.limit(Number.MAX_SAFE_INTEGER);

    const query = Parse.Query.or(usernameQuery, emailQuery);
    query.descending('timeofreport');
    query.limit(Number.MAX_SAFE_INTEGER);
    return query.find();
  });
}

app.use('/submissions', (req, res) => {
  getSubmissions(req)
    .then(async results => {
      const Task = Parse.Object.extend('tasks');
      const Submission = Parse.Object.extend('submission');
      const submissionPointers = results.map(({ id }) =>
        Submission.createWithoutData(id),
      );

      const taskQuery = new Parse.Query(Task);
      taskQuery.containedIn('submission', submissionPointers);
      taskQuery.limit(Number.MAX_SAFE_INTEGER);
      const allTasks = await taskQuery.find();

      const tasksBySubmissionId = {};
      allTasks.forEach(task => {
        const subId = task.get('submission').id;
        if (!tasksBySubmissionId[subId]) {
          tasksBySubmissionId[subId] = [];
        }
        tasksBySubmissionId[subId].push({
          objectId: task.id,
          ...task.attributes,
        });
      });

      return results.map(({ id, attributes }) => ({
        objectId: id,
        ...attributes,
        tasks: tasksBySubmissionId[id] || [],
      }));
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
      return submission
        .destroy()
        .catch(error => {
          if (error.message === 'Object not found for delete.') {
            console.info(
              `/api/deleteSubmission: swallowing false Parse error "Object not found for delete."`,
            );
            return;
          }

          throw error;
        })
        .then(() => {
          res.json({ objectId });
        });
    })
    .catch(handlePromiseRejection(res));
});

app.get('/srlookup/:reqnumber', (req, res) => {
  const { reqnumber } = req.params;

  srlookup({ reqnumber })
    .then(result => {
      res.json(result);
    })
    .catch(handlePromiseRejection(res));
});

app.use('/requestPasswordReset', (req, res) => {
  const { email } = req.body;

  // http://docs.parseplatform.org/js/guide/#resetting-passwords
  Parse.User.requestPasswordReset(email)
    .catch(error => {
      if (error?.message?.startsWith('No user found with email')) {
        return;
      }

      throw error;
    })
    .then(() => res.end())
    .catch(handlePromiseRejection(res));
});

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
          typeofcomplaint,
          latitude,
          longitude,
          CreateDate,
        }).forEach(([key, value]) => {
          if (!value) {
            throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
          }
        });

        const timezone = process.env.TZ;
        process.env.TZ = 'America/New_York';
        if (timeofreport.valueOf() > Date.now()) {
          const message = `Timestamp cannot be in the future (submitted time: ${timeofreport}, actual time: ${new Date()})`;
          process.env.TZ = timezone;
          throw { message }; // eslint-disable-line no-throw-literal
        }

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
          passenger: false,
          locationNumber: 1,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          latitude1: latitude,
          longitude1: longitude,
          location: new Parse.GeoPoint({ latitude, longitude }),
          loc1_address: formatted_address, // eslint-disable-line camelcase
          timeofreport,
          timeofreported,
          reportDescription,
          can_be_shared_publicly, // eslint-disable-line camelcase
          status: 0,
          operating_system: 'web',
          version_number: Number(HEROKU_RELEASE_VERSION.slice(1)),
          reqnumber: 'N/A until submitted to 311',
        });
        submission.setACL(new Parse.ACL(user));

        // upload attachments
        // http://docs.parseplatform.org/js/guide/#creating-a-parsefile

        const attachmentsWithFormats = await Promise.all(
          attachmentData.map(async ({ buffer: attachmentBuffer }) => ({
            attachmentBuffer,
            ext: (await FileType.fromBuffer(attachmentBuffer)).ext,
          })),
        );

        const images = attachmentsWithFormats.filter(isImage);
        const videos = attachmentsWithFormats.filter(isVideo);

        await Promise.all([
          ...images
            .slice(0, 3)
            .map(async ({ attachmentBuffer, ext }, index) => {
              const key = `photoData${index}`;
              const file = new Parse.File(`${key}.${ext}`, {
                base64: attachmentBuffer.toString('base64'),
              });
              await file.save();
              submission.set(key, file);
            }),
          ...videos
            .slice(0, 3)
            .map(async ({ attachmentBuffer, ext }, index) => {
              const key = `videoData${index}`;
              const file = new Parse.File(`${key}.${ext}`, {
                base64: attachmentBuffer.toString('base64'),
              });
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

// adapted from https://docs.platerecognizer.com/?javascript#license-plate-recognition
app.use(
  '/platerecognizer',
  upload.single('attachmentFile'),
  async (req, res) => {
    const { email, password } = req.body;

    try {
      await logIn({ email, password });
    } catch (error) {
      handlePromiseRejection(res)(error);
      return;
    }

    const attachmentBuffer = req.file.buffer;

    readLicenseViaALPR({
      attachmentBuffer,
      PLATERECOGNIZER_TOKEN,
      PLATERECOGNIZER_TOKEN_TWO,
    })
      .then(data => res.json(data))
      .catch(handlePromiseRejection(res));
  },
);

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
app.use('/getVehicleType/:licensePlate/:licenseState?', (req, res) => {
  const { licensePlate = 'GNS7685', licenseState = 'NY' } = req.params;
  getVehicleType({ licensePlate, licenseState })
    .then(({ result }) => res.json({ result }))
    .catch(handlePromiseRejection(res));
});

app.get('/submissions-map', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Complaint Map</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Syne:wght@700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0c0d10;
    --surface: #13151a;
    --surface2: #1c1f27;
    --border: #252830;
    --border2: #333748;
    --accent: #d4ff4e;
    --text: #dde0e8;
    --muted: #5c6070;
    --crosswalk: #d4ff4e;
    --bikelane: #4ecbff;
    --redlight: #ff6b35;
    --reckless: #ff4466;
    --illegal: #b87fff;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'DM Mono', monospace;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── PASTE SCREEN ── */
  #paste-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    gap: 20px;
  }

  #paste-screen h1 {
    font-family: 'Syne', sans-serif;
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }

  #paste-screen p {
    font-size: 0.7rem;
    color: var(--muted);
    letter-spacing: 0.03em;
    text-align: center;
    max-width: 520px;
    line-height: 1.75;
  }

  #paste-screen p code {
    color: var(--text);
    background: var(--surface2);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.67rem;
  }

  #json-input {
    width: 100%;
    max-width: 640px;
    height: 210px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 4px;
    color: var(--text);
    font-family: 'DM Mono', monospace;
    font-size: 0.68rem;
    padding: 14px;
    resize: vertical;
    outline: none;
    transition: border-color 0.15s;
    line-height: 1.55;
  }

  #json-input:focus { border-color: var(--accent); }
  #json-input::placeholder { color: var(--muted); font-style: italic; }

  #error-msg {
    font-size: 0.67rem;
    color: var(--reckless);
    letter-spacing: 0.03em;
    display: none;
    max-width: 640px;
  }

  #load-btn {
    background: var(--accent);
    color: #0c0d10;
    border: none;
    border-radius: 3px;
    padding: 10px 30px;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 0.78rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
  }

  #load-btn:hover { opacity: 0.85; transform: translateY(-1px); }
  #load-btn:active { transform: translateY(0); }

  /* ── MAP SCREEN ── */
  #map-screen {
    flex: 1;
    display: none;
    flex-direction: column;
  }

  header {
    padding: 11px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
  }

  header h1 {
    font-family: 'Syne', sans-serif;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    white-space: nowrap;
  }

  .count-badge {
    font-size: 0.6rem;
    color: var(--muted);
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    margin-left: auto;
    align-items: center;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.58rem;
    color: var(--muted);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  #reset-btn {
    background: none;
    border: 1px solid var(--border2);
    color: var(--muted);
    border-radius: 3px;
    padding: 5px 11px;
    font-family: 'DM Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  #reset-btn:hover { color: var(--text); border-color: var(--text); }

  #map { flex: 1; }

  /* ── POPUP ── */
  #popup {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    width: 300px;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 18px 52px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03);
    opacity: 0;
    transform: translateY(8px) scale(0.96);
    transition: opacity 0.13s, transform 0.13s;
  }

  #popup.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  #popup.pinned {
    pointer-events: auto;
    border-color: var(--accent);
    box-shadow: 0 18px 52px rgba(0,0,0,0.8), 0 0 0 1px rgba(212,255,78,0.2);
  }

  .popup-header {
    padding: 10px 30px 9px 12px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    position: relative;
  }

  #popup-close {
    display: none;
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: 1px solid var(--border2);
    color: var(--muted);
    border-radius: 2px;
    width: 18px;
    height: 18px;
    font-size: 11px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    transition: color 0.1s, border-color 0.1s;
    font-family: monospace;
    line-height: 1;
    padding: 0;
  }

  #popup-close:hover { color: var(--text); border-color: var(--text); }
  #popup.pinned #popup-close { display: flex; }

  .popup-complaint {
    font-family: 'Syne', sans-serif;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    margin-bottom: 5px;
  }

  .popup-meta {
    font-size: 0.59rem;
    color: var(--muted);
    line-height: 1.75;
  }

  .popup-meta .val { color: var(--text); }

  .popup-photos { display: flex; }

  .popup-photos img {
    flex: 1;
    min-width: 0;
    height: 136px;
    object-fit: contain;
    background: #08090c;
    display: block;
    border-right: 1px solid var(--border);
  }

  .popup-photos img:last-child { border-right: none; }

  .popup-no-photo {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.58rem;
    color: var(--muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-style: italic;
  }

  /* Leaflet overrides */
  .leaflet-container { background: #08090c !important; }
  .leaflet-tile { filter: saturate(0.2) brightness(0.7) hue-rotate(190deg); }
  .leaflet-control-attribution { background: rgba(19,21,26,0.9) !important; color: var(--muted) !important; font-family: 'DM Mono', monospace !important; font-size: 9px !important; }
  .leaflet-control-attribution a { color: var(--muted) !important; }
  .leaflet-control-zoom a { background: var(--surface) !important; color: var(--text) !important; border-color: var(--border2) !important; font-family: monospace !important; }
</style>
</head>
<body>

<!-- PASTE SCREEN -->
<div id="paste-screen">
  <h1>Complaint Report Map</h1>
  <p>
    Paste your JSON below — either a JSON array <code>[{...}, {...}]</code> or newline-delimited objects <code>{...}\\n{...}</code>.<br>
    Each object needs a <code>location</code> with <code>latitude</code> &amp; <code>longitude</code>. Optional: <code>typeofcomplaint</code>, <code>license</code>, <code>loc1_address</code>, <code>timeofreport</code>, <code>photoData0/1/2</code>.
  </p>
  <textarea id="json-input" placeholder='Paste JSON here, e.g.:
[
  {
    "location": { "latitude": 40.686, "longitude": -73.979 },
    "typeofcomplaint": "Blocked the crosswalk",
    "license": "T794438C",
    "state": "NY",
    "loc1_address": "64 Flatbush Ave, Brooklyn",
    "timeofreport": { "iso": "2023-04-28T17:04:00.000Z" },
    "photoData0": { "url": "https://example.com/photo.jpg" },
    "photoData1": null,
    "photoData2": null
  }
]'></textarea>
  <div id="error-msg"></div>
  <button id="load-btn">Load Map →</button>
</div>

<!-- MAP SCREEN -->
<div id="map-screen">
  <header>
    <h1>Complaint Map</h1>
    <span class="count-badge" id="count-badge"></span>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:var(--crosswalk)"></div>Blocked crosswalk</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--bikelane)"></div>Blocked bike lane</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--redlight)"></div>Ran red light</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--reckless)"></div>Drove recklessly</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--illegal)"></div>Illegal parking</div>
      <div class="legend-item"><div class="legend-dot" style="background:#aaa"></div>Other</div>
    </div>
    <button id="reset-btn">← New Data</button>
  </header>
  <div id="map"></div>
</div>

<!-- HOVER POPUP -->
<div id="popup">
  <div class="popup-header">
    <div class="popup-complaint" id="popup-complaint"></div>
    <div class="popup-meta" id="popup-meta"></div>
    <button id="popup-close" title="Close">✕</button>
  </div>
  <div id="popup-photos"></div>
</div>

<script>
const COMPLAINT_COLORS = {
  'crosswalk': '#d4ff4e',
  'bike lane': '#4ecbff',
  'red light': '#ff6b35',
  'stop sign': '#ff6b35',
  'recklessly': '#ff4466',
  'illegally': '#b87fff',
  'illegal': '#b87fff',
};

function colorFor(complaint) {
  if (!complaint) return '#aaaaaa';
  const lower = complaint.toLowerCase();
  for (const [key, color] of Object.entries(COMPLAINT_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return '#aaaaaa';
}

function makeIcon(color) {
  const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="5" fill="\${color}" stroke="#0c0d10" stroke-width="2.5"/></svg>\`;
  return L.divIcon({ html: svg, className: '', iconSize: [14,14], iconAnchor: [7,7] });
}

function formatDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(e) { return iso; }
}

// Parse: JSON array OR newline-delimited JSON objects
function parseInput(raw) {
  raw = raw.trim();
  if (raw.startsWith('[')) return JSON.parse(raw);

  // Accumulate objects by brace depth
  const objects = [];
  let depth = 0, start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') { if (depth++ === 0) start = i; }
    else if (raw[i] === '}') { if (--depth === 0 && start !== -1) { objects.push(JSON.parse(raw.slice(start, i+1))); start = -1; } }
  }
  if (objects.length > 0) return objects;
  throw new Error('Could not parse input as JSON array or newline-delimited objects.');
}

let map = null;
let markerLayer = null;

const popup     = document.getElementById('popup');
const popupComp = document.getElementById('popup-complaint');
const popupMeta = document.getElementById('popup-meta');
const popupPics = document.getElementById('popup-photos');
const closeBtn  = document.getElementById('popup-close');

let hideTimer = null;
let pinned    = false;

function positionPopup(clientX, clientY) {
  const margin = 16, pw = 300, ph = 320;
  let x = clientX + 16, y = clientY - 24;
  if (x + pw > window.innerWidth  - margin) x = clientX - pw - 14;
  if (y + ph > window.innerHeight - margin) y = window.innerHeight - ph - margin;
  if (y < margin) y = margin;
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
}

function populatePopup(s) {
  const photos = [s.photoData0, s.photoData1, s.photoData2].filter(p => p && p.url);
  const color  = colorFor(s.typeofcomplaint);

  popupComp.textContent = s.typeofcomplaint || 'Unknown complaint';
  popupComp.style.color = color;

  const rows = [];
  if (s.license) rows.push(\`<span class="val">\${s.license}</span>\${s.state ? ' · <span class="val">'+s.state+'</span>' : ''}\`);
  if (s.loc1_address) rows.push(\`<span class="val">\${s.loc1_address}</span>\`);
  const d = formatDate(s.timeofreport?.iso);
  if (d) rows.push(d);
  if (s.reqnumber) rows.push(\`req <span class="val">\${s.reqnumber}</span>\`);
  popupMeta.innerHTML = rows.join('<br>');

  if (photos.length > 0) {
    popupPics.innerHTML = \`<div class="popup-photos">\${photos.map(p =>
      \`<img src="\${p.url}" loading="lazy" onerror="this.style.display='none'">\`).join('')}</div>\`;
  } else {
    popupPics.innerHTML = \`<div class="popup-no-photo">no photos attached</div>\`;
  }
}

function unpinPopup() {
  pinned = false;
  popup.classList.remove('pinned', 'visible');
}

closeBtn.addEventListener('click', unpinPopup);

// Click anywhere on the map (not a marker) closes a pinned popup
document.getElementById('map').addEventListener('click', () => {
  if (pinned) unpinPopup();
});

function showPopup(e, s) {
  if (pinned) return; // don't disturb a pinned popup on hover
  clearTimeout(hideTimer);
  populatePopup(s);
  positionPopup(e.originalEvent.clientX, e.originalEvent.clientY);
  popup.classList.remove('pinned');
  popup.classList.add('visible');
}

function hidePopup() {
  if (pinned) return;
  hideTimer = setTimeout(() => popup.classList.remove('visible'), 90);
}

function pinPopup(e, s) {
  clearTimeout(hideTimer);
  pinned = true;
  populatePopup(s);
  positionPopup(e.originalEvent.clientX, e.originalEvent.clientY);
  popup.classList.add('visible', 'pinned');
  L.DomEvent.stopPropagation(e); // prevent map click from immediately closing it
}

function loadMap(submissions) {
  document.getElementById('paste-screen').style.display = 'none';
  const mapScreen = document.getElementById('map-screen');
  mapScreen.style.display = 'flex';
  document.getElementById('count-badge').textContent = \`\${submissions.length} report\${submissions.length !== 1 ? 's' : ''}\`;

  if (!map) {
    map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  } else {
    markerLayer.clearLayers();
  }

  const bounds = [];

  submissions.forEach(s => {
    const lat = s.location?.latitude;
    const lng = s.location?.longitude;
    if (lat == null || lng == null) return;
    bounds.push([lat, lng]);

    const marker = L.marker([lat, lng], { icon: makeIcon(colorFor(s.typeofcomplaint)) });
    marker.on('mouseover', e => showPopup(e, s));
    marker.on('mousemove', e => { if (!pinned) positionPopup(e.originalEvent.clientX, e.originalEvent.clientY); });
    marker.on('mouseout', hidePopup);
    marker.on('click', e => pinPopup(e, s));
    markerLayer.addLayer(marker);
  });

  if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40] });
  setTimeout(() => map.invalidateSize(), 60);
}

document.getElementById('load-btn').addEventListener('click', () => {
  const raw = document.getElementById('json-input').value.trim();
  const errEl = document.getElementById('error-msg');
  errEl.style.display = 'none';

  if (!raw) { errEl.textContent = 'Please paste some JSON first.'; errEl.style.display = 'block'; return; }

  try {
    const data = parseInput(raw);
    if (!Array.isArray(data) || data.length === 0) throw new Error('Expected a non-empty array of submission objects.');
    loadMap(data);
  } catch(e) {
    errEl.textContent = \`Parse error: \${e.message}\`;
    errEl.style.display = 'block';
  }
});

document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('map-screen').style.display = 'none';
  document.getElementById('paste-screen').style.display = 'flex';
  pinned = false;
  popup.classList.remove('visible', 'pinned');
});
</script>
</body>
</html>`);
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
      <StyleContext.Provider value={{ insertCss }}>
        <App context={context}>{route.component}</App>
      </StyleContext.Provider>,
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
