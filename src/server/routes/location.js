/**
 * Location validation routes: /api/validate_location, /api/process_validation
 */

import { validateLocation, processValidation } from '../../geoclient.js';
import { handlePromiseRejection } from '../errorHandler';

/**
 * Register location routes on Express app
 * @param {Object} app - Express app instance
 */
export function registerLocationRoutes(app) {
  app.use('/api/validate_location', (req, res) => {
    const { lat, long } = req.body;
    validateLocation({ lat, long })
      .then(body => res.json(body))
      .catch(handlePromiseRejection(res));
  });

  app.use('/api/process_validation', (req, res) => {
    const { lat, long } = req.body;
    processValidation({ lat, long })
      .then(body => res.json(body))
      .catch(handlePromiseRejection(res));
  });
}

export default registerLocationRoutes;
