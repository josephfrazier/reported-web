/**
 * Categories route: /api/categories
 */

import { handlePromiseRejection } from '../errorHandler';

/**
 * Register categories route on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Object} options.Parse - Parse SDK instance
 */
export function registerCategoriesRoute(app, { Parse }) {
  app.use('/api/categories', (req, res) => {
    const Category = Parse.Object.extend('Category');
    const query = new Parse.Query(Category);
    query
      .find()
      .then(results => {
        const categories = results.map(({ id, attributes }) => ({
          objectId: id,
          ...attributes,
        }));
        res.json({ categories });
      })
      .catch(handlePromiseRejection(res));
  });
}

export default registerCategoriesRoute;
