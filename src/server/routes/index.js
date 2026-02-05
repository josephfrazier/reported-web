/**
 * Route registration index
 * Centralizes all route registrations for the Express app
 */

import { createAuthService, registerAuthRoutes } from './auth';
import { registerSubmissionRoutes } from './submissions';
import { registerSubmitRoute } from './submit';
import { registerLocationRoutes } from './location';
import { registerCategoriesRoute } from './categories';
import { registerPlaterecognizerRoute } from './platerecognizer';
import { registerVehicleTypeRoute } from './vehicleType';
import { registerSrlookupRoute } from './srlookup';

/**
 * Register all API routes on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Object} options.Parse - Parse SDK instance
 * @param {Object} options.upload - Multer upload instance
 * @param {string} options.herokuReleaseVersion - HEROKU_RELEASE_VERSION env var
 * @param {string} options.platerecognizerToken - PLATERECOGNIZER_TOKEN env var
 * @param {string} options.platerecognizerTokenTwo - PLATERECOGNIZER_TOKEN_TWO env var
 */
export function registerRoutes(
  app,
  {
    Parse,
    upload,
    herokuReleaseVersion,
    platerecognizerToken,
    platerecognizerTokenTwo,
  },
) {
  // Create auth service for dependency injection
  const authService = createAuthService({ Parse });

  // Register all routes
  registerAuthRoutes(app, { authService, Parse });
  registerSubmissionRoutes(app, { authService, Parse });
  registerSubmitRoute(app, {
    authService,
    Parse,
    upload,
    herokuReleaseVersion,
  });
  registerLocationRoutes(app);
  registerCategoriesRoute(app, { Parse });
  registerPlaterecognizerRoute(app, {
    authService,
    upload,
    platerecognizerToken,
    platerecognizerTokenTwo,
  });
  registerVehicleTypeRoute(app);
  registerSrlookupRoute(app);
}

export { createAuthService };
