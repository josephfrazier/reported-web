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
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import expressJwt, { UnauthorizedError as Jwt401Error } from 'express-jwt';
import { graphql } from 'graphql';
import expressGraphQL from 'express-graphql';
import jwt from 'jsonwebtoken';
import nodeFetch from 'node-fetch';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';
import OpenalprApi from 'openalpr_api';
import Parse from 'parse/node';
import omit from 'object.omit';
import fileType from 'file-type-es5';
import sharp from 'sharp';

import App from './components/App';
import Html from './components/Html';
import { ErrorPageWithoutStyle } from './routes/error/ErrorPage';
import errorPageStyle from './routes/error/ErrorPage.css';
import createFetch from './createFetch';
import passport from './passport';
import router from './router';
import models from './data/models';
import schema from './data/schema';
// import assets from './asset-manifest.json'; // eslint-disable-line import/no-unresolved
import chunks from './chunk-manifest.json'; // eslint-disable-line import/no-unresolved
import config from './config';

require('dotenv').config();

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
  // send entire app down. Process manager will restart it
  process.exit(1);
});

// http://docs.parseplatform.org/js/guide/#getting-started
Parse.initialize(process.env.PARSE_APP_ID, process.env.PARSE_JAVASCRIPT_KEY);
Parse.serverURL = process.env.PARSE_SERVER_URL;

//
// Tell any CSS tooling (such as Material UI) to use all vendor prefixes if the
// user agent is not known.
// -----------------------------------------------------------------------------
global.navigator = global.navigator || {};
global.navigator.userAgent = global.navigator.userAgent || 'all';

const app = express();
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
app.use(bodyParser.json({ limit: '10mb' }));

//
// Authentication
// -----------------------------------------------------------------------------
app.use(
  expressJwt({
    secret: config.auth.jwt.secret,
    credentialsRequired: false,
    getToken: req => req.cookies.id_token,
  }),
);
// Error handler for express-jwt
app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  if (err instanceof Jwt401Error) {
    console.error('[express-jwt-error]', req.cookies.id_token);
    // `clearCookie`, otherwise user can't use web-app until cookie expires
    res.clearCookie('id_token');
  }
  next(err);
});

app.use(passport.initialize());

app.get(
  '/login/facebook',
  passport.authenticate('facebook', {
    scope: ['email', 'user_location'],
    session: false,
  }),
);
app.get(
  '/login/facebook/return',
  passport.authenticate('facebook', {
    failureRedirect: '/login',
    session: false,
  }),
  (req, res) => {
    const expiresIn = 60 * 60 * 24 * 180; // 180 days
    const token = jwt.sign(req.user, config.auth.jwt.secret, { expiresIn });
    res.cookie('id_token', token, { maxAge: 1000 * expiresIn, httpOnly: true });
    res.redirect('/');
  },
);

//
// Register API middleware
// -----------------------------------------------------------------------------
app.use(
  '/graphql',
  expressGraphQL(req => ({
    schema,
    graphiql: __DEV__,
    rootValue: { request: req },
    pretty: __DEV__,
  })),
);

function saveUser({
  email,
  password,
  FirstName,
  LastName,
  Building,
  StreetName,
  Apt,
  Borough,
  Phone,
  testify,
}) {
  // adapted from http://docs.parseplatform.org/js/guide/#signing-up
  const user = new Parse.User();
  const username = email;
  const useremail = email;
  const fields = {
    username,
    useremail,
    email,
    password,
    FirstName,
    LastName,
    Building,
    StreetName,
    Apt,
    Borough,
    Phone,
    testify,
  };
  user.set(fields);

  return user
    .signUp(null)
    .catch(() => Parse.User.logIn(username, password))
    .then(userAgain => {
      userAgain.set(omit(fields, 'email')); // don't re-set email since that triggers a verification email
      return userAgain.save(null, {
        // sessionToken must be manually passed in:
        // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
        sessionToken: userAgain.get('sessionToken'),
      });
    });
}

app.use('/requestPasswordReset', (req, res) => {
  const { body } = req;
  const { email } = body;

  // http://docs.parseplatform.org/js/guide/#resetting-passwords
  Parse.User.requestPasswordReset(email)
    .then(() => res.end())
    .catch(error => {
      console.error({ error });
      res.status(500).json({ error });
    });
});

app.use('/submit', (req, res) => {
  const { body } = req;

  const {
    email,
    password,
    FirstName,
    LastName,
    Building,
    StreetName,
    Apt,
    Borough,
    Phone,
    testify,

    plate,
    typeofuser,
    typeofreport = 'complaint',
    typeofcomplaint,
    reportDescription,
    can_be_shared_publicly, // eslint-disable-line camelcase
    latitude,
    longitude,
    imageBytess = [],
    CreateDate,
  } = body;

  const timeofreport = new Date(CreateDate);
  const timeofreported = timeofreport;

  saveUser({
    email,
    password,
    FirstName,
    LastName,
    Building,
    StreetName,
    Apt,
    Borough,
    Phone,
    testify,
  })
    .then(async user => {
      console.info({ user });
      if (!user.get('emailVerified')) {
        user.set({ email }); // reset email to trigger a verification email
        user.save(null, {
          // sessionToken must be manually passed in:
          // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
          sessionToken: user.get('sessionToken'),
        });
        const message = `Please verify ${email} and try again. You should have received a message.`;
        throw { message }; // eslint-disable-line no-throw-literal
      }

      // make sure all required fields are present
      Object.entries({
        FirstName,
        LastName,
        Building,
        StreetName,
        Apt,
        Borough,
        Phone,

        plate,
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
        Borough,
        Building,
        Apt,
        testify,
        StreetName,

        Username: email,

        typeofreport,
        selectedReport: typeofreport === 'complaint' ? 1 : 0,
        medallionNo: plate,
        typeofcomplaint,
        typeofuser: typeofuser.toLowerCase(),
        passenger: typeofuser.toLowerCase() === 'passenger',
        locationNumber: 1,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        latitude1: latitude,
        longitude1: longitude,
        timeofreport,
        timeofreported,
        reportDescription,
        can_be_shared_publicly,
        status: 0,
        operating_system: 'web',
        version_number: Number(process.env.HEROKU_RELEASE_VERSION.slice(1)),
        reqnumber: 'N/A until submitted to 311',
      });

      // upload images
      // http://docs.parseplatform.org/js/guide/#creating-a-parsefile

      const images = imageBytess
        .map(imageBytes => ({
          imageBytes,
          ext: fileType(Buffer.from(imageBytes, 'base64')).ext,
        }))
        .filter(({ ext }) => ['jpg', 'png', 'jpeg'].includes(ext));

      await Promise.all(
        images.map(async ({ imageBytes, ext }, index) => {
          // TODO handle photos/videos separately
          // https://reportedcab.slack.com/messages/C85007FUY/p1523149628000063
          const key = `photoData${index}`;
          const file = new Parse.File(`${key}.${ext}`, { base64: imageBytes });
          await file.save();
          submission.set(key, file);
        }),
      );
      return submission.save(null);
      // TODO logout after submission is saved
      // http://docs.parseplatform.org/js/guide/#sessions
      // Note that Parse.User.logOut() won't work here:
      // https://github.com/parse-community/parse-server/issues/2553
      // https://github.com/parse-community/Parse-SDK-JS/issues/393
      // Also, you can't just query sessions by token and delete it:
      // https://github.com/parse-community/Parse-SDK-JS/issues/83
    })
    .then(submission => {
      console.info({ submission });

      res.json({ submission });
    })
    .catch(error => {
      console.error({ error });
      res.status(500).json({ error });
    });
});

// adapted from https://github.com/openalpr/cloudapi/tree/8141c1ba57f03df4f53430c6e5e389b39714d0e0/javascript#getting-started
app.use('/openalpr', (req, res) => {
  const { imageBytes, country, opts } = req.body;
  const api = new OpenalprApi.DefaultApi();

  const secretKey = process.env.OPENALPR_SECRET_KEY; // {String} The secret key used to authenticate your account. You can view your secret key by visiting https://cloud.openalpr.com/

  const imageBuffer = Buffer.from(imageBytes, 'base64');
  console.time(`/openalpr rotate`); // eslint-disable-line no-console
  sharp(imageBuffer)
    .rotate()
    .toBuffer()
    .catch(() => imageBuffer)
    .then(buffer => {
      console.timeEnd(`/openalpr rotate`); // eslint-disable-line no-console
      const imageBytesRotated = buffer.toString('base64');
      console.time(`/openalpr recognizeBytes`); // eslint-disable-line no-console
      api.recognizeBytes(
        imageBytesRotated,
        secretKey,
        country,
        opts,
        (error, data) => {
          console.timeEnd(`/openalpr recognizeBytes`); // eslint-disable-line no-console
          if (error) {
            throw error;
          } else {
            res.json(data);
          }
        },
      );
    });
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
      schema,
      graphql,
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
const promise = models.sync().catch(err => console.error(err.stack));
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
