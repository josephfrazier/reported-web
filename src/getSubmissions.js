import Parse from 'parse/node';

import accountIdentifiers from './accountIdentifiers.js';

// `authenticate` is injected for testability; in production it comes from
// src/session.js, so the query runs for whoever the request is authenticated
// as.
const getSubmissions = ({ authenticate }) =>
  authenticate().then(({ user }) => {
    const Submission = Parse.Object.extend('submission');
    // Both of the account's identifiers (username and email) are matched, not
    // just the username: logIn() accepts either, and a mobile account's
    // username is not always the address that ends up on its reports. See
    // accountIdentifiers.js.
    const identifiers = accountIdentifiers(user);

    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users.
    const usernameQuery = new Parse.Query(Submission);
    usernameQuery.containedIn('Username', identifiers);
    usernameQuery.descending('timeofreport');
    usernameQuery.limit(Number.MAX_SAFE_INTEGER);

    // Also search by "email" since submissions from iOS clients don't always
    // have this set.
    const emailQuery = new Parse.Query(Submission);
    emailQuery.containedIn('email', identifiers);
    emailQuery.descending('timeofreport');
    emailQuery.limit(Number.MAX_SAFE_INTEGER);

    // The native clients set the `user` pointer but not always either address
    // field, so their submissions would otherwise be invisible to their own
    // reporter. The pointer names the creating account exactly, so it needs
    // no identifier matching.
    const pointerQuery = new Parse.Query(Submission);
    pointerQuery.equalTo('user', user);
    pointerQuery.descending('timeofreport');
    pointerQuery.limit(Number.MAX_SAFE_INTEGER);

    const query = Parse.Query.or(usernameQuery, emailQuery, pointerQuery);
    // Sort by when the photo was taken (timeofreport), newest first, and break
    // ties by when the submission was created (createdAt), newest first, so a
    // later submission appears before an earlier one with the same photo
    // timestamp. NOTE: ParseQuery.descending() resets _order each call, so
    // both keys must be passed together.
    query.descending(['timeofreport', 'createdAt']);
    query.limit(Number.MAX_SAFE_INTEGER);
    // Submissions' ACLs name only the Parse user that created them, and the
    // mobile clients create a separate user for the same reporter (see the
    // Username/email matching above). A query as the logged-in user would
    // therefore hide every mobile submission, so this read uses the master
    // key.
    return query.find({ useMasterKey: true });
  });

export default getSubmissions;
