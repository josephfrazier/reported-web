/**
 * Submission routes: /submissions, /api/deleteSubmission
 */

import assert from 'assert';

import { handlePromiseRejection } from '../errorHandler';

/**
 * Get user's submissions
 * @param {Object} req - Express request
 * @param {Object} options
 * @param {Function} options.saveUser - Auth service saveUser function
 * @param {Object} options.Parse - Parse SDK instance
 * @returns {Promise<Parse.Object[]>}
 */
async function getSubmissions(req, { saveUser, Parse }) {
  return saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');

    const usernameQuery = new Parse.Query(Submission);
    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users
    usernameQuery.equalTo('Username', user.get('username'));
    usernameQuery.descending('timeofreport');
    usernameQuery.limit(Number.MAX_SAFE_INTEGER);

    // Also search by "email" since submissions from iOS clients don't always have this set
    const emailQuery = new Parse.Query(Submission);
    emailQuery.equalTo('email', user.get('username'));
    emailQuery.descending('timeofreport');
    emailQuery.limit(Number.MAX_SAFE_INTEGER);

    const query = Parse.Query.or(usernameQuery, emailQuery);
    query.descending('timeofreport');
    query.limit(Number.MAX_SAFE_INTEGER);
    return query.find();
  });
}

/**
 * Register submission routes on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Object} options.authService - Auth service instance
 * @param {Object} options.Parse - Parse SDK instance
 */
export function registerSubmissionRoutes(app, { authService, Parse }) {
  const { saveUser } = authService;

  app.use('/submissions', (req, res) => {
    getSubmissions(req, { saveUser, Parse })
      .then(results => {
        const submissions = results.map(({ id, attributes }) => ({
          objectId: id,
          ...attributes,
        }));
        return submissions;
      })
      .then(submissions => {
        res.json({ submissions });
      })
      .catch(handlePromiseRejection(res));
  });

  app.use('/api/deleteSubmission', (req, res) => {
    const { objectId } = req.body;
    getSubmissions(req, { saveUser, Parse })
      .then(submissions => {
        const submission = submissions.find(sub => sub.id === objectId);
        assert(submission); // TODO make it obvious that this is necessary
        return submission.destroy().then(() => {
          res.json({ objectId });
        });
      })
      .catch(handlePromiseRejection(res));
  });
}

export default registerSubmissionRoutes;
