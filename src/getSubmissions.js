import Parse from 'parse/node';

// `saveUser` is injected for testability; in production it defaults to
// server.js's user-creation glue.
const getSubmissions = ({ req, saveUser }) =>
  saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');

    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users.
    const usernameQuery = new Parse.Query(Submission);
    usernameQuery.equalTo('Username', user.get('username'));
    usernameQuery.descending('timeofreport');
    usernameQuery.limit(Number.MAX_SAFE_INTEGER);

    // Also search by "email" since submissions from iOS clients don't always
    // have this set.
    const emailQuery = new Parse.Query(Submission);
    emailQuery.equalTo('email', user.get('username'));
    emailQuery.descending('timeofreport');
    emailQuery.limit(Number.MAX_SAFE_INTEGER);

    const query = Parse.Query.or(usernameQuery, emailQuery);
    // Sort by when the photo was taken (timeofreport), newest first, and break
    // ties by when the submission was created (createdAt), newest first, so a
    // later submission appears before an earlier one with the same photo
    // timestamp. NOTE: ParseQuery.descending() resets _order each call, so
    // both keys must be passed together.
    query.descending(['timeofreport', 'createdAt']);
    query.limit(Number.MAX_SAFE_INTEGER);
    return query.find();
  });

export default getSubmissions;
