import assert from 'assert';

import getSubmissions from './getSubmissions.js';

// Extracted from server.js's /api/deleteSubmission handler so the deletion
// logic can be tested against a real Parse Server without the surrounding
// HTTP glue. `saveUser` is injected for testability; in production it
// defaults to server.js's user-creation glue.
const deleteSubmission = ({ req, saveUser }) => {
  const { objectId } = req.body;
  return getSubmissions({ req, saveUser }).then(submissions => {
    const submission = submissions.find(sub => sub.id === objectId);
    assert(submission); // TODO make it obvious that this is necessary
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
};

export default deleteSubmission;
