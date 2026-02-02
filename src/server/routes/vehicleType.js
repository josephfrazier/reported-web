/**
 * Vehicle type route: /getVehicleType
 */

import getVehicleType from '../../getVehicleType.js';
import { handlePromiseRejection } from '../errorHandler';

/**
 * Register vehicle type route on Express app
 * @param {Object} app - Express app instance
 */
export function registerVehicleTypeRoute(app) {
  // ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
  app.use('/getVehicleType/:licensePlate/:licenseState?', (req, res) => {
    const { licensePlate = 'GNS7685', licenseState = 'NY' } = req.params;
    getVehicleType({ licensePlate, licenseState })
      .then(({ result }) => res.json({ result }))
      .catch(handlePromiseRejection(res));
  });
}

export default registerVehicleTypeRoute;
