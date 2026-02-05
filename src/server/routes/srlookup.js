/**
 * SR Lookup route: /srlookup/:reqnumber
 */

import srlookup from '../../srlookup.js';
import { handlePromiseRejection } from '../errorHandler';

/**
 * Register SR lookup route on Express app
 * @param {Object} app - Express app instance
 */
export function registerSrlookupRoute(app) {
  app.get('/srlookup/:reqnumber', (req, res) => {
    const { reqnumber } = req.params;

    srlookup({ reqnumber })
      .then(result => {
        res.json(result);
      })
      .catch(handlePromiseRejection(res));
  });
}

export default registerSrlookupRoute;
