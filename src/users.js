import crypto from 'crypto';

import Parse from 'parse/node';

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

  // parse-server keeps one session per (user, installationId) and deletes
  // that user's other sessions for the same installation id whenever one is
  // created (parse-server's RestWrite#destroyDuplicatedSessions). This SDK
  // otherwise sends one process-wide installation id, so every login through
  // this server would replace the previous browser's session and log that
  // browser out. A fresh id per login gives each login its own session.
  const installationId = crypto.randomUUID();

  return user
    .signUp(null, { installationId })
    .catch(() => Parse.User.logIn(username, password, { installationId }))
    .then(userAgain => {
      // Not the user object itself: it carries the session token, which is
      // the credential the browser's cookie holds.
      console.info('Logged in', userAgain.id);
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
