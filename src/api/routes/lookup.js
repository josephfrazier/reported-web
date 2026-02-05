/**
 * Lookup service routes (SR lookup, vehicle type)
 */

import { validateLocation, processValidation } from '../../geoclient.js';
import getVehicleType from '../../getVehicleType.js';
import srlookup from '../../srlookup.js';
import handlePromiseRejection from '../middleware/errorHandler.js';

/**
 * Setup lookup routes
 * @param {object} app - Express app
 */
export default function setupLookupRoutes(app) {
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

  app.get('/srlookup/:reqnumber', (req, res) => {
    const { reqnumber } = req.params;

    srlookup({ reqnumber })
      .then(result => {
        res.json(result);
      })
      .catch(handlePromiseRejection(res));
  });

  // ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
  app.use('/getVehicleType/:licensePlate/:licenseState?', (req, res) => {
    const { licensePlate = 'GNS7685', licenseState = 'NY' } = req.params;
    getVehicleType({ licensePlate, licenseState })
      .then(({ result }) => res.json({ result }))
      .catch(handlePromiseRejection(res));
  });
}
