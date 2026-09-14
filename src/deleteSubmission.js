import Parse from 'parse/node';

// Extracted from server.js's /api/deleteSubmission handler so the deletion
// logic can be tested against a real Parse Server without the surrounding
// HTTP glue. `saveUser` is injected for testability; in production it
// defaults to server.js's user-creation glue.

// "The submission doesn't exist" and "the submission isn't the user's" must
// be indistinguishable, so the route can't be used to confirm that someone
// else's objectId refers to a real submission. The message covers both
// possibilities for honest debugging without specifying which one it was.
const submissionNotFoundOrNotYoursError = () => {
  const error = new Error(
    'the submission was not found or was not made by this user',
  );
  // Error's `message` property is non-enumerable, so handlePromiseRejection's
  // json-stringify-safe round-trip would drop it before it reaches the
  // client. Make it enumerable, like Parse.Error's own message is.
  Object.defineProperty(error, 'message', {
    enumerable: true,
    value: error.message,
  });
  return error;
};

const deleteSubmission = ({ req, saveUser }) => {
  const { objectId } = req.body;
  return saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');
    const query = new Parse.Query(Submission);
    return query
      .get(objectId)
      .catch(error => {
        if (error.code === 101) {
          throw submissionNotFoundOrNotYoursError();
        }

        throw error;
      })
      .then(submission => {
        // Verify that the logged-in user actually made this submission before
        // deleting it. Getting the submission by id directly avoids loading
        // every submission the user has ever made, like getSubmissions() did.
        // The Username/email match is what that listing used to filter by,
        // since iOS submissions don't always have Username set.
        const madeByThisUser =
          submission.get('Username') === user.get('username') ||
          submission.get('email') === user.get('username');
        if (!madeByThisUser) {
          throw submissionNotFoundOrNotYoursError();
        }

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
