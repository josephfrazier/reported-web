/**
 * User management routes
 */

import Parse from 'parse/node';
import handlePromiseRejection from '../middleware/errorHandler.js';

/**
 * Log in or register a user
 * @param {object} credentials
 * @param {string} credentials.email - User email
 * @param {string} credentials.password - User password
 * @returns {Promise<Parse.User>} Logged in user
 */
export async function logIn({ email, password }) {
  // adapted from http://docs.parseplatform.org/js/guide/#signing-up
  const user = new Parse.User();
  const username = email;
  const fields = {
    username,
    email,
    password,
  };
  user.set(fields);

  return user
    .signUp(null)
    .catch(() => Parse.User.logIn(username, password))
    .then(userAgain => {
      console.info({ user: userAgain });
      if (!userAgain.get('emailVerified')) {
        userAgain.set({ email }); // reset email to trigger a verification email
        userAgain.save(null, {
          // sessionToken must be manually passed in:
          // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
          sessionToken: userAgain.get('sessionToken'),
        });
        const message = `We just sent you an email with a link to confirm your address, please find and click that.`;
        throw { message }; // eslint-disable-line no-throw-literal
      }
      return userAgain;
    });
}

/**
 * Save user profile information
 * @param {object} userData
 * @param {string} userData.email - User email
 * @param {string} userData.password - User password
 * @param {string} userData.FirstName - User first name
 * @param {string} userData.LastName - User last name
 * @param {string} userData.Phone - User phone
 * @param {boolean} userData.testify - Whether user will testify
 * @returns {Promise<Parse.User>} Updated user
 */
export async function saveUser({
  email,
  password,
  FirstName,
  LastName,
  Phone,
  testify,
}) {
  // make sure all required fields are present
  Object.entries({
    FirstName,
    LastName,
    Phone,
  }).forEach(([key, value]) => {
    if (!value) {
      throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
    }
  });

  const useremail = email;
  const fields = {
    useremail,
    FirstName,
    LastName,
    Phone,
    testify,
  };

  return logIn({ email, password }).then(userAgain => {
    userAgain.set(fields);
    return userAgain.save(null, {
      // sessionToken must be manually passed in:
      // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
      sessionToken: userAgain.get('sessionToken'),
    });
  });
}

/**
 * Setup user management routes
 * @param {object} app - Express app
 */
export function setupUserRoutes(app) {
  app.use('/api/logIn', (req, res) => {
    logIn(req.body)
      .then(user => res.json(user))
      .catch(handlePromiseRejection(res));
  });

  app.use('/saveUser', (req, res) => {
    saveUser(req.body)
      .then(user => res.json(user))
      .catch(handlePromiseRejection(res));
  });

  app.use('/requestPasswordReset', (req, res) => {
    const { email } = req.body;

    // http://docs.parseplatform.org/js/guide/#resetting-passwords
    Parse.User.requestPasswordReset(email)
      .catch(error => {
        if (error?.message?.startsWith('No user found with email')) {
          return;
        }

        throw error;
      })
      .then(() => res.end())
      .catch(handlePromiseRejection(res));
  });
}
