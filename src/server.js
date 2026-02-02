/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import express from 'express';
import nodeFetch from 'node-fetch';
import Parse from 'parse/node';

import config from './config';
import chunks from './chunk-manifest.json'; // eslint-disable-line import/no-unresolved
import { createParseClient } from './server/parseClient';
import {
  createUpload,
  setupGlobalNavigator,
  registerMiddleware,
} from './server/middleware';
import { registerRoutes } from './server/routes';
import { registerSsrMiddleware, registerErrorMiddleware } from './server/ssr';

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

// Initialize Parse client
createParseClient({
  Parse,
  appId: PARSE_APP_ID,
  javascriptKey: PARSE_JAVASCRIPT_KEY,
  masterKey: PARSE_MASTER_KEY,
  serverUrl: PARSE_SERVER_URL,
});

// Create multer upload instance
const upload = createUpload();

// Set up global navigator for CSS tooling
setupGlobalNavigator();

// Create Express app
const app = express();

// Register middleware
registerMiddleware(app, __dirname);

// Register API routes
registerRoutes(app, {
  Parse,
  upload,
  herokuReleaseVersion: HEROKU_RELEASE_VERSION,
  platerecognizerToken: PLATERECOGNIZER_TOKEN,
  platerecognizerTokenTwo: PLATERECOGNIZER_TOKEN_TWO,
});

// Register server-side rendering middleware
registerSsrMiddleware(app, { nodeFetch, chunks });

// Register error handling middleware
registerErrorMiddleware(app);

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
