/**
 * Plate recognizer route: /platerecognizer
 */

import readLicenseViaALPR from '../../alpr';
import { handlePromiseRejection } from '../errorHandler';

/**
 * Register platerecognizer route on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Object} options.authService - Auth service instance
 * @param {Object} options.upload - Multer upload instance
 * @param {string} options.platerecognizerToken - PLATERECOGNIZER_TOKEN env var
 * @param {string} options.platerecognizerTokenTwo - PLATERECOGNIZER_TOKEN_TWO env var
 */
export function registerPlaterecognizerRoute(
  app,
  { authService, upload, platerecognizerToken, platerecognizerTokenTwo },
) {
  const { logIn } = authService;

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
        PLATERECOGNIZER_TOKEN: platerecognizerToken,
        PLATERECOGNIZER_TOKEN_TWO: platerecognizerTokenTwo,
      })
        .then(data => res.json(data))
        .catch(handlePromiseRejection(res));
    },
  );
}

export default registerPlaterecognizerRoute;
