/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

import path from 'path';
import express from 'express';
import forceSsl from 'force-ssl-heroku';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';

import { ErrorPageWithoutStyle } from './routes/error/ErrorPage';
import errorPageStyle from './routes/error/ErrorPage.css';
import Html from './components/Html';
import config from './config';
import { initializeParse } from './utils/parseSetup.js';
import { setupUserRoutes } from './api/routes/users.js';
import { setupSubmissionRoutes } from './api/routes/submissions.js';
import setupLookupRoutes from './api/routes/lookup.js';
import setupFileRoutes from './api/routes/files.js';
import renderPage from './utils/renderPage.js';

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
} = process.env;

require('heroku-self-ping').default(config.api.serverUrl, {
  verbose: true,
});

// Initialize Parse backend
initializeParse({
  appId: PARSE_APP_ID,
  javascriptKey: PARSE_JAVASCRIPT_KEY,
  masterKey: PARSE_MASTER_KEY,
  serverURL: PARSE_SERVER_URL,
});

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
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '80mb' }));
// attachments are no longer sent as base64 JSON, but bodyParser still tries to parse non-JSON bodies, so this 80mb `limit` needs to be here to avoid errors

//
// Register API routes
// -----------------------------------------------------------------------------
setupUserRoutes(app);
setupSubmissionRoutes(app);
setupLookupRoutes(app);
setupFileRoutes(app);

//
// Register server-side rendering middleware
// -----------------------------------------------------------------------------
app.get('*', async (req, res, next) => {
  try {
    const pageData = await renderPage(req);

    if (pageData.redirect) {
      res.redirect(pageData.status || 302, pageData.redirect);
      return;
    }

    res.status(pageData.status || 200);
    res.send(`<!doctype html>${pageData.html}`);
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
