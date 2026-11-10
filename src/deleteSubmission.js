import Parse from 'parse/node';

import accountIdentifiers from './accountIdentifiers.js';

// Extracted from server.js's /api/deleteSubmission handler so the deletion
// logic can be tested against a real Parse Server without the surrounding
// HTTP glue. `authenticate` is injected for testability; in production it
// comes from src/session.js.

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

// What a submission's `reqnumber` says until the backend sends it to 311.
const PENDING_REQNUMBER = 'N/A until submitted to 311';

// A submission the backend has taken up is not the user's to remove: the
// service request is real, and deleting the record here only loses its links.
// A task record says so, even before its case number arrives. The delete
// control is hidden in that case, but a page can sit open while the backend
// takes the report, so the check runs here as well.
const hasGoneTo311 = async submission => {
  const status = submission.get('status');
  if (status != null && Number(status) !== 0) {
    return true;
  }

  const reqnumber = submission.get('reqnumber');
  if (reqnumber && reqnumber !== PENDING_REQNUMBER) {
    return true;
  }

  const Task = Parse.Object.extend('tasks');
  const taskQuery = new Parse.Query(Task);
  taskQuery.equalTo('submission', submission);
  const task = await taskQuery.first();
  return Boolean(task);
};

const submissionAlreadySentError = () => {
  const error = new Error(
    'this submission has already been sent to 311, so it cannot be deleted',
  );
  // Same reason as above: the message has to survive the round-trip.
  Object.defineProperty(error, 'message', {
    enumerable: true,
    value: error.message,
  });
  return error;
};

const deleteSubmission = ({ req, authenticate }) => {
  const { objectId } = req.body;
  return authenticate().then(({ user }) => {
    const Submission = Parse.Object.extend('submission');
    const query = new Parse.Query(Submission);
    // Fetched with the master key for the same reason getSubmissions() lists
    // with it: a submission made by the mobile client belongs to a different
    // Parse user, and its ACL would otherwise hide it from this user's
    // session. The explicit ownership check below is what decides; the ACL
    // never was.
    return query
      .get(objectId, { useMasterKey: true })
      .catch(error => {
        if (error.code === 101) {
          throw submissionNotFoundOrNotYoursError();
        }

        throw error;
      })
      .then(async submission => {
        // Verify that the logged-in user actually made this submission before
        // deleting it. Getting the submission by id directly avoids loading
        // every submission the user has ever made, like getSubmissions() did.
        // Ownership is either the `user` pointer (the account that created
        // it) or one of the account's identifiers in the address fields, for
        // the reason in accountIdentifiers.js; the native clients do not
        // always set those fields.
        const owner = submission.get('user');
        const ownedByPointer = Boolean(owner?.id) && owner.id === user.id;
        const matchesIdentifier = accountIdentifiers(user).some(
          identifier =>
            submission.get('Username') === identifier ||
            submission.get('email') === identifier,
        );
        const madeByThisUser = ownedByPointer || matchesIdentifier;
        if (!madeByThisUser) {
          throw submissionNotFoundOrNotYoursError();
        }

        if (await hasGoneTo311(submission)) {
          throw submissionAlreadySentError();
        }

        return submission
          .destroy({ useMasterKey: true })
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
