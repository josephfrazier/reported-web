/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */

if (process.env.BROWSER) {
  throw new Error(
    'Do not import `config.js` from inside the client-side code.',
  );
}

// The values below are read when this module first evaluates, which happens
// before any statement in the importing module runs, so load .env here.
require('dotenv').config();

module.exports = {
  // Node.js app
  port: process.env.PORT || 3000,

  // https://expressjs.com/en/guide/behind-proxies.html
  //
  // 'uniquelocal' is the private ranges: 10/8, 172.16/12, 192.168/16 and
  // fc00::/7. Heroku's router sits in one of those, and the default used to be
  // 'loopback', which it is not -- so `req.ip` was the router and every client
  // shared one address. Anything keyed on it was shared with it: the rate
  // limiter on /api/uploadAttachment allowed 30 uploads per 15 minutes for the
  // whole app rather than per client.
  //
  // A client cannot use this to forge an address. The router appends the real
  // client address to X-Forwarded-For, and Express reads the chain from the
  // right, so entries a client sends sit to the left of the one that counts.
  trustProxy: process.env.TRUST_PROXY || 'uniquelocal',

  // API Gateway
  api: {
    // API URL to be used in the client-side code
    clientUrl: process.env.API_CLIENT_URL || '',
    // API URL to be used in the server-side code
    serverUrl:
      process.env.API_SERVER_URL ||
      (process.env.HEROKU_APP_NAME &&
        `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`) ||
      `http://localhost:${process.env.PORT || 3000}`,
  },

  // Database
  databaseUrl: process.env.DATABASE_URL || 'sqlite:database.sqlite',

  // Web analytics
  analytics: {
    // https://analytics.google.com/
    googleTrackingId: process.env.GOOGLE_TRACKING_ID, // UA-XXXXX-X
  },

  // Errors and logs
  sentry: {
    // The DSN is public by design; the client bundle carries it too.
    dsn: process.env.SENTRY_DSN,
  },
};
