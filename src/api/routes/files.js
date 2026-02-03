/**
 * File processing routes (ALPR/plate recognition)
 */

import readLicenseViaALPR from '../../alpr.js';
import handlePromiseRejection from '../middleware/errorHandler.js';
import { logIn } from './users.js';
import upload from '../middleware/upload.js';

const { PLATERECOGNIZER_TOKEN, PLATERECOGNIZER_TOKEN_TWO } = process.env;

/**
 * Setup file processing routes
 * @param {object} app - Express app
 */
export default function setupFileRoutes(app) {
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
}
