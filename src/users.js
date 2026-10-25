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
    .then(async userAgain => {
      // Not the user object itself: it carries the session token, which is
      // the credential the browser's cookie holds.
      console.info('Logged in', userAgain.id);
      if (!userAgain.get('emailVerified')) {
        // Ask parse-server for another verification email. That write needs
        // the user's own session, but with `preventLoginWithUnverifiedEmail`
        // (which Back4App sets) sign-up returns no session token at all
        // (parse-server's RestWrite#createSessionTokenIfNeeded), and sign-up
        // already sent the email. So when there is no token, skip the
        // resend: the unauthenticated write comes back as "Cannot modify
        // user" (206), which the global master key used to hide until #1047,
        // and the unhandled rejection now exits the process (src/server.js).
        const sessionToken = userAgain.getSessionToken();
        if (sessionToken) {
          userAgain.set({ email }); // reset email to trigger a verification email
          try {
            await userAgain.save(null, {
              // sessionToken must be manually passed in:
              // https://github.com/parse-community/parse-server/issues/1729#issuecomment-218932566
              sessionToken,
            });
          } catch (error) {
            console.error('Could not resend the verification email:', error);
          }
        }
        const message = `We just sent you an email with a link to confirm your address, please find and click that.`;
        throw { message }; // eslint-disable-line no-throw-literal
      }
      return userAgain;
    });
}

// Saves the profile fields onto an already-authenticated user, with the
// session token that authenticated them. Credentials are not involved: the
// caller (a route) resolved the user from the session cookie, or through
// logIn()'s transitional fallback.
export async function updateUserProfile({
  user,
  sessionToken,
  email,
  FirstName,
  LastName,
  Phone,
  testify,
  can_be_shared_publicly: canBeSharedPublicly,
  withhold_contact_info_from_nypd, // eslint-disable-line camelcase
  receive_nypd_sr_updates_by_email, // eslint-disable-line camelcase
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

  user.set({
    useremail: email,
    FirstName,
    LastName,
    Phone,
    testify,
    // Unlike withhold_contact_info_from_nypd below, this one is always
    // stored, like testify: the native app defaults it to true when the
    // user record lacks it, so leaving false implicit would make the two
    // apps disagree about the same account.
    can_be_shared_publicly: canBeSharedPublicly,
  });

  // Sparse on the user, like on submissions: only stored when true.
  // unset() on false keeps non-opt-ins clean, while an absent param (from
  // clients that don't know about the flag) leaves any previous opt-in
  // alone.
  // eslint-disable-next-line camelcase
  const withholdContactInfoFromNypd = withhold_contact_info_from_nypd;
  if (withholdContactInfoFromNypd === true) {
    user.set('withhold_contact_info_from_nypd', true);
  } else if (withholdContactInfoFromNypd === false) {
    user.unset('withhold_contact_info_from_nypd');
  }

  // eslint-disable-next-line camelcase
  const receiveNypdSrUpdatesByEmail = receive_nypd_sr_updates_by_email;
  if (receiveNypdSrUpdatesByEmail === true) {
    user.set('receive_nypd_sr_updates_by_email', true);
  } else if (receiveNypdSrUpdatesByEmail === false) {
    user.unset('receive_nypd_sr_updates_by_email');
  }

  return user.save(null, { sessionToken });
}
