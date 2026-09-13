import assert from 'assert';

import Parse from 'parse/node';

// Extracted from server.js's /api/deleteSubmission handler so the deletion
// logic can be tested against a real Parse Server without the surrounding
// HTTP glue. `saveUser` is injected for testability; in production it
// defaults to server.js's user-creation glue.
const deleteSubmission = ({ req, saveUser }) => {
  const { objectId } = req.body;
  return saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');
    const query = new Parse.Query(Submission);
    return query.get(objectId).then(submission => {
      // Verify that the logged-in user actually made this submission before
      // deleting it. Getting the submission by id directly avoids loading
      // every submission the user has ever made, like getSubmissions() did.
      // The Username/email match is what that listing used to filter by,
      // since iOS submissions don't always have Username set.
      assert(
        submission.get('Username') === user.get('username') ||
          submission.get('email') === user.get('username'),
        'the submission was not made by this user',
      );
      return submission
        .destroy()
        .catch(error => {
          if (error.message === 'Object not found for delete.') {
            console.info(
              `/api/deleteSubmission: swallowing false Parse error "Object not found for delete."`,
            );
            return;
          }

          throw error;
        })
        .then(() => ({ objectId }));
    });
  });
};

export default deleteSubmission;
