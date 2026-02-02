/**
 * Express middleware configuration
 */

import path from 'path';
import express from 'express';
import forceSsl from 'force-ssl-heroku';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import multer from 'multer';

import config from '../config';

/**
 * Configure multer for file uploads
 * @returns {Object} Configured multer instance
 */
export function createUpload() {
  return multer({
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
}

/**
 * Set up global navigator for CSS tooling (Material UI)
 */
export function setupGlobalNavigator() {
  // Tell any CSS tooling (such as Material UI) to use all vendor prefixes if the
  // user agent is not known.
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
}

/**
 * Register standard Express middleware
 * @param {Object} app - Express app instance
 * @param {string} dirname - __dirname from server.js
 */
export function registerMiddleware(app, dirname) {
  app.use(compression());
  app.use(forceSsl);

  // If you are using proxy from external machine, you can set TRUST_PROXY env
  // Default is to trust proxy headers only from loopback interface.
  app.set('trust proxy', config.trustProxy);

  // Register Node.js middleware
  app.use(express.static(path.resolve(dirname, 'public')));
  app.use(cookieParser());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json({ limit: '80mb' }));
  // attachments are no longer sent as base64 JSON, but bodyParser still tries
  // to parse non-JSON bodies, so this 80mb `limit` needs to be here to avoid errors
}
