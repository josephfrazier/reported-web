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

module.exports = {
  // Node.js app
  port: process.env.PORT || 3000,

  // https://expressjs.com/en/guide/behind-proxies.html
  // Heroku's router is not a loopback peer, so trusting loopback alone made
  // `req.ip` the router's address for every request, which collapsed the
  // `/api/uploadAttachment` rate limit into one bucket shared by all users
  // (see the "Unexpected end of form" section of the README). `uniquelocal`
  // covers the private ranges the router connects from. The value is a list
  // of addresses and ranges, not a count of proxy hops, because it arrives as
  // a string: `TRUST_PROXY=1` would be read as a host named "1".
  trustProxy: process.env.TRUST_PROXY || 'loopback,uniquelocal',

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
};
