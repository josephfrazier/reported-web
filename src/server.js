/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import path from 'path';
import { execSync } from 'child_process';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import forceSsl from 'force-ssl-heroku';
import compression from 'compression';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';
import Parse from 'parse/node';
import cookie from 'cookie';
import multer from 'multer';
import StyleContext from 'isomorphic-style-loader/StyleContext';
import * as Sentry from '@sentry/node';

import { geosearch } from './geoclient.js';
import getVehicleType from './getVehicleType.js';
import srlookup from './srlookup.js';
import getSubmissionsWithTasks from './getSubmissionsWithTasks.js';
import deleteSubmission from './deleteSubmission.js';
import createSubmission from './createSubmission.js';
import uploadAttachment from './uploadAttachment.js';
import getAttachmentData from './getAttachmentData.js';
import {
  canAfford,
  forgetUpload,
  recordUpload,
  releaseUploads,
} from './attachmentBudget.js';
import { attachmentId } from './attachmentStore.js';
import handlePromiseRejection from './handlePromiseRejection.js';
import { logIn, updateUserProfile } from './users.js';
import {
  authenticateRequest,
  clearSessionCookie,
  readSessionToken,
  rejectCrossSiteRequest,
  resolveSsrSession,
  setSessionCookie,
} from './session.js';

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
import getReviewAppSource from './getReviewAppSource.js';
import { relayEnvelope } from './sentryTunnel.js';

let commitHash = process.env.HEROKU_BUILD_COMMIT || 'unknown';
if (commitHash === 'unknown') {
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    console.warn('Could not determine git commit hash:', e.message);
  }
}

// Errors, unhandled rejections, and console logs go to Sentry. This must
// run before the unhandledRejection handler below, so that Sentry's own
// listener captures the rejection before that handler ends the process.
if (config.sentry.dsn) {
  Sentry.init({
    dsn: config.sentry.dsn,
    // The build pins the release so it matches the uploaded source maps.
    release: process.env.SENTRY_RELEASE || commitHash,
    environment: process.env.NODE_ENV || 'development',
    integrations: defaultIntegrations => [
      ...defaultIntegrations,
      Sentry.consoleLoggingIntegration({
        levels: ['log', 'info', 'warn', 'error'],
      }),
    ],
  });
}

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
  // send entire app down. Process manager will restart it
  const exit = () => process.exit(1);
  if (Sentry.getClient()) {
    // Give the captured event time to leave before the process dies.
    Sentry.close(2000).then(exit, exit);
  } else {
    exit();
  }
});

const {
  PARSE_APP_ID,
  PARSE_JAVASCRIPT_KEY,
  PARSE_MASTER_KEY,
  PARSE_SERVER_URL,
  SHOW_PARSE_SERVER_BANNER,
  HEROKU_RELEASE_VERSION,
  PLATERECOGNIZER_TOKEN,
  PLATERECOGNIZER_TOKEN_TWO,
} = process.env;

// http://docs.parseplatform.org/js/guide/#getting-started
//
// Requests carry the master key only where a call site opts in with
// { useMasterKey: true }: the reads that must bypass ACLs, which are
// submissions belonging to another Parse user with the same email, and the
// public map's query. Every other request runs as the logged-in user, via an
// explicit sessionToken, or with no credential at all.
Parse.initialize(PARSE_APP_ID, PARSE_JAVASCRIPT_KEY, PARSE_MASTER_KEY);
Parse.serverURL = PARSE_SERVER_URL;

// Whether to show the "NOT PRODUCTION" banner on the home page. Enabled via
// the SHOW_PARSE_SERVER_BANNER config var, which app.json sets only for
// Heroku review apps — so the decision is made by the deployment's
// environment, never hardcoded here, and the banner always displays the
// live PARSE_SERVER_URL config var.
const showParseServerBanner = !!SHOW_PARSE_SERVER_BANNER;

// The pull request or branch this deployment came from, so the banner can
// link back to it. Heroku sets these config vars on review apps only, so
// production and local runs show the banner without a link.
const { url: reviewAppUrl, label: reviewAppLabel } = getReviewAppSource() || {};

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
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '80mb' }));
// attachments are no longer sent as base64 JSON, but express's internal usage of `body-parser` still tries to parse non-JSON bodies, so this 80mb `limit` needs to be here to avoid errors

// Busboy reports "Unexpected end of form" when a multipart body ends before
// its closing boundary, which is what browsers have been sending when they
// drop an upload's body (see the "Unexpected end of form" section of the
// README). The error alone doesn't say which route it came from or what the
// client claimed it was sending, so log the facts that identify those cases:
// a `contentLength` of 0 means the body never arrived at all.
const logTruncatedMultipartBody = (error, req) => {
  if (error.message !== 'Unexpected end of form') {
    return;
  }
  console.error('Multipart body ended early: ("Unexpected end of form")', {
    url: req.originalUrl,
    contentLength: req.headers['content-length'],
    transferEncoding: req.headers['transfer-encoding'],
    userAgent: req.headers['user-agent'],
  });
};

// SameSite=Lax already keeps the session cookie off cross-site POSTs in
// current browsers; this guard covers older ones and login CSRF. It applies
// to every non-GET request below, and lets GET/HEAD/OPTIONS and requests
// with no Origin/Referer (non-browser clients) through.
app.use(rejectCrossSiteRequest);

// The one place a password is accepted. The session it creates goes into the
// HttpOnly cookie, and the response carries only the profile fields the
// client uses -- never the token.
app.use('/api/logIn', (req, res) => {
  logIn(req.body)
    .then(user => {
      setSessionCookie(res, req, user.getSessionToken());
      res.json({
        email: user.get('email'),
        FirstName: user.get('FirstName'),
        LastName: user.get('LastName'),
        Phone: user.get('Phone'),
        testify: user.get('testify'),
      });
    })
    .catch(handlePromiseRejection(res));
});

app.use('/api/logOut', (req, res) => {
  const sessionToken = readSessionToken(req);
  const revoke = sessionToken
    ? Parse.User.logOut({ sessionToken }).catch(error => {
        // The cookie goes either way; a failed revoke just leaves the
        // session to expire on its own.
        console.error({ error });
      })
    : Promise.resolve();

  revoke.then(() => {
    clearSessionCookie(res, req);
    res.json({});
  });
});

// One line per browser that migrates pre-cookie localStorage state, so the
// migration can be counted from the logs (the client posts here once).
app.use('/api/legacyStateMigrated', (req, res) => {
  console.info('[home] legacy localStorage state migrated');
  res.status(204).end();
});

// The browser SDK sends its envelopes here instead of to Sentry's own
// domain, which content blockers drop. The relay forwards them only for
// this app's DSN; see src/sentryTunnel.js. The client sends them with
// `fetch`'s default text/plain content type, and Sentry's own ingest
// accepts that too.
app.post(
  '/monitoring',
  express.raw({
    type: ['application/x-sentry-envelope', 'text/plain'],
    limit: '1mb',
  }),
  (req, res) => {
    if (!config.sentry.dsn) {
      res.sendStatus(404);
      return;
    }
    relayEnvelope(req.body, { dsn: config.sentry.dsn }).then(
      status => res.sendStatus(status),
      error => {
        console.error('Failed to relay a Sentry envelope:', error.message);
        res.sendStatus(400);
      },
    );
  },
);

app.use('/saveUser', (req, res) => {
  authenticateRequest(req, res)()
    .then(({ user, sessionToken }) =>
      updateUserProfile({
        user,
        sessionToken,
        email: req.body.email,
        FirstName: req.body.FirstName,
        LastName: req.body.LastName,
        Phone: req.body.Phone,
        testify: req.body.testify,
      }),
    )
    .then(user => res.json(user))
    .catch(handlePromiseRejection(res));
});

app.use('/api/geosearch', (req, res) => {
  const { lat, long } = req.body;
  geosearch({ lat, long })
    .then(body => res.json(body))
    .catch(handlePromiseRejection(res));
});

app.use('/submissions', (req, res) => {
  getSubmissionsWithTasks({ authenticate: authenticateRequest(req, res) })
    .then(submissions => {
      res.json({ submissions });
    })
    .catch(handlePromiseRejection(res));
});

app.use('/api/deleteSubmission', (req, res) => {
  deleteSubmission({ req, authenticate: authenticateRequest(req, res) })
    .then(({ objectId }) => res.json({ objectId }))
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

// What a client may pre-upload is metered in bytes rather than in requests
// (see attachmentBudget.js); this is only a flood stop, and it runs before
// multer so that a burst is refused before the server buffers a body for it.
// It sits far above any rate a real uploader reaches, because the byte budget
// is what actually bounds them.
app.use(
  '/api/uploadAttachment',
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 60, // 60 uploads per minute per IP
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }),
  upload.single('attachmentData'),
  async (req, res) => {
    // Authenticate before the budget below is checked: a refused request must
    // not spend any of it.
    try {
      await authenticateRequest(req, res)();
    } catch (authError) {
      handlePromiseRejection(res)(authError);
      return;
    }

    // multer has the size and the body is already buffered, so this is the
    // first point at which what the upload costs is known.
    const { ip } = req;
    const { size, buffer } = req.file;
    const id = attachmentId(buffer);

    if (!canAfford({ ip, bytes: size })) {
      handlePromiseRejection(res)({
        status: 429,
        message: `Too many unsubmitted attachments are already held. Submit a report, or wait out the hour they are kept for, and try again.`,
      });
      return;
    }

    // The budget is taken before the upload is written, and there is no await
    // between the two: a report's photos are uploaded together, and checking
    // and spending in separate turns would let all of them spend the same last
    // byte. A refusal below gives it back.
    recordUpload({ ip, id, bytes: size });

    try {
      await uploadAttachment({ buffer });
    } catch (error) {
      forgetUpload({ ip, id });
      handlePromiseRejection(res)(error);
      return;
    }

    res.json({ id });
  },
);

app.use('/submit', (req, res) => {
  // Call upload.array directly to intercept errors and respond with JSON, see the following:
  // https://github.com/expressjs/multer/tree/80ee2f52432cc0c81c93b03c6b0b448af1f626e5#error-handling
  upload.array('attachmentData[]')(req, res, async error => {
    if (error) {
      logTruncatedMultipartBody(error, req);
      // Make error.message enumerable so it gets sent to the client
      const { message } = error;
      handlePromiseRejection(res)({ ...error, message });
      return;
    }

    let user;
    let sessionToken;
    try {
      ({ user, sessionToken } = await authenticateRequest(req, res)());
    } catch (authError) {
      handlePromiseRejection(res)(authError);
      return;
    }

    const {
      email,
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
      omit_contact_info_from_nypd: omit_contact_info_from_nypdString, // eslint-disable-line camelcase
      latitude: latitudeString,
      longitude: longitudeString,
      formatted_address, // eslint-disable-line camelcase
      CreateDate,
    } = req.body;

    const testify = testifyString === 'true';
    const can_be_shared_publicly = can_be_shared_publiclyString === 'true'; // eslint-disable-line camelcase
    // eslint-disable-next-line camelcase
    const omit_contact_info_from_nypd =
      omit_contact_info_from_nypdString === 'true'; // eslint-disable-line camelcase
    const latitude = Number(latitudeString);
    const longitude = Number(longitudeString);

    let attachmentData;
    try {
      attachmentData = await getAttachmentData({
        attachmentIdsJson: req.body.attachmentIds,
        files: req.files,
      });
    } catch (attachmentError) {
      handlePromiseRejection(res)(attachmentError);
      return;
    }

    createSubmission({
      user,
      sessionToken,
      email,
      FirstName,
      LastName,
      Phone,
      testify,

      plate,
      licenseState,
      typeofreport,
      typeofcomplaint,
      reportDescription,
      can_be_shared_publicly, // eslint-disable-line camelcase
      latitude,
      longitude,
      formatted_address, // eslint-disable-line camelcase
      CreateDate,
      attachmentData,
      versionNumber: Number(HEROKU_RELEASE_VERSION.slice(1)),
      omit_contact_info_from_nypd, // eslint-disable-line camelcase
    })
      .then(submission => {
        console.info({ submission });
        res.json({ submission });
        // The submission used whatever pre-uploads it named, so they stop
        // counting against the client's budget. Waiting for it is not worth
        // holding the response open.
        releaseUploads({
          ip: req.ip,
          attachmentIdsJson: req.body.attachmentIds,
        }).catch(releaseError => console.error({ releaseError }));
      })
      .catch(handlePromiseRejection(res));
  });
});

// adapted from https://docs.platerecognizer.com/?javascript#license-plate-recognition
app.use(
  '/platerecognizer',
  upload.single('attachmentFile'),
  async (req, res) => {
    try {
      await authenticateRequest(req, res)();
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

app.get('/submissions-map', async (req, res) => {
  // This static page does not go through the SSR route below, so run the same
  // session resolution here: a visitor who lands straight on the map gets
  // their legacy cookie migrated (and an existing session cookie slid),
  // instead of having to detour through the home page first.
  await resolveSsrSession({ req, res });
  res.sendFile(path.resolve(__dirname, 'public', 'submissions-map.html'));
});

const POLYGON_FIELDS = [
  'location',
  'timeofreport',
  'license',
  'state',
  'typeofcomplaint',
  'loc1_address',
  'reqnumber',
  'photoData0',
  'photoData1',
  'photoData2',
  'can_be_shared_publicly',
];

const POLYGON_RESULT_LIMIT = 10000;

app.get('/api/submissions-in-polygon', (req, res) => {
  let polygonCoords = null;

  const polygonParam = req.query.polygon;
  if (typeof polygonParam !== 'string' || !polygonParam.trim()) {
    res.status(400).json({
      error:
        'Query parameter "polygon" is required and must be a non-empty string.',
    });
    return;
  }

  const rawVertices = polygonParam.trim().split(';');
  if (rawVertices.length < 3) {
    res.status(400).json({ error: 'Polygon must have at least 3 vertices.' });
    return;
  }
  try {
    polygonCoords = rawVertices.map((pair, idx) => {
      const parts = pair.split(',');
      if (parts.length !== 2) {
        throw new Error(`Vertex ${idx} is invalid: expected "lat,lng"`);
      }
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error(`Vertex ${idx} has non-numeric coordinates`);
      }
      if (lat < -90 || lat > 90) {
        throw new Error(`Vertex ${idx} latitude out of range (-90 to 90)`);
      }
      if (lng < -180 || lng > 180) {
        throw new Error(`Vertex ${idx} longitude out of range (-180 to 180)`);
      }
      return [lng, lat];
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  const Submission = Parse.Object.extend('submission');
  const query = new Parse.Query(Submission);
  query.withinPolygon('location', polygonCoords);
  query.equalTo('can_be_shared_publicly', true);
  query.notEqualTo('license', 'TEST');
  query.limit(POLYGON_RESULT_LIMIT);
  query.select(POLYGON_FIELDS);

  query
    // The submissions this returns belong to other users by design (that is
    // the point of the public map), and their ACLs only name their own
    // owner, so this read has to bypass them. Granting public read access at
    // creation time instead would expose every field the reporters did not
    // agree to share (name, phone, and so on), so the master key stays.
    .find({ useMasterKey: true })
    .then(parseResults => {
      const results = parseResults.map(obj => {
        const json = obj.toJSON();
        return Object.fromEntries(
          POLYGON_FIELDS.map(k => [k, json[k] ?? null]),
        );
      });

      res.json({
        results,
        capped: parseResults.length >= POLYGON_RESULT_LIMIT,
      });
    })
    .catch(handlePromiseRejection(res));
});

//
// Firefox with the React DevTools browser extension installed injects
// `installHook.js` into the page, then tries to fetch the script's source
// map relative to the page's origin (`/installHook.js.map`). Without this
// route, that request falls through to the SSR catch-all below and gets a
// 404 page, filling the browser console with:
//   Source map error: Error: request failed with status 404
// Serve a valid empty source map to silence it, as suggested in:
// https://github.com/facebook/react/issues/32339
// -----------------------------------------------------------------------------
app.get('/installHook.js.map', (req, res) => {
  res.type('application/json');
  res.send(
    '{"version":3,"file":"installHook.js","sources":["installHook.js"],"sourcesContent":[""],"mappings":""}',
  );
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
    const fetch = createFetch(globalThis.fetch, {
      baseUrl: config.api.serverUrl,
      cookie: req.headers.cookie,
    });

    // Parse cookies from the request header into a plain object
    const cookies = cookie.parse(req.headers.cookie || '');

    // Decide whether this page is logged in, and migrate a legacy visitor
    // whose state cookie still holds their password (see session.js). Never
    // rejects: the page renders even if Parse is unreachable.
    const { sessionPresent, homeState } = await resolveSsrSession({ req, res });
    if (homeState) {
      // resolveSsrSession may have rewritten the state cookie (stripping the
      // password); the route must render the rewritten state, not the
      // header's.
      cookies.reportedWebHomeState = JSON.stringify(homeState);
    }

    // Global (context) variables that can be easily accessed from any React component
    // https://facebook.github.io/react/docs/context.html
    const context = {
      insertCss,
      fetch,
      commitHash,
      parseServerUrl: PARSE_SERVER_URL,
      showParseServerBanner,
      reviewAppUrl,
      reviewAppLabel,
      cookies,
      sessionPresent,
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
      commitHash,
      sentryDsn: config.sentry.dsn,
      parseServerUrl: PARSE_SERVER_URL,
      showParseServerBanner,
      reviewAppUrl,
      reviewAppLabel,
      // The session cookie is HttpOnly, so the client cannot read it; this is
      // how hydration learns the request was logged in.
      sessionPresent,
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
  logTruncatedMultipartBody(err, req);
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
