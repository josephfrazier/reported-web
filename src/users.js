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
