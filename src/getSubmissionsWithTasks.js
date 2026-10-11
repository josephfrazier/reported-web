import Parse from 'parse/node';

import getSubmissions from './getSubmissions.js';

// getSubmissions() plus the tasks join the /submissions route performs, so
// each submission comes back with its TLC/311 task records attached.
// Extracted from server.js so the response shape has real-Parse coverage.
export default async function getSubmissionsWithTasks({ authenticate }) {
  const results = await getSubmissions({ authenticate });

  const Task = Parse.Object.extend('tasks');
  const Submission = Parse.Object.extend('submission');
  const submissionPointers = results.map(({ id }) =>
    Submission.createWithoutData(id),
  );

  const taskQuery = new Parse.Query(Task);
  taskQuery.containedIn('submission', submissionPointers);
  taskQuery.limit(Number.MAX_SAFE_INTEGER);
  // Task records carry no ACL (the TLC/311 importer creates them that way),
  // so this join needs neither the master key nor the user's session token.
  const allTasks = await taskQuery.find();

  const tasksBySubmissionId = {};
  allTasks.forEach(task => {
    const subId = task.get('submission').id;
    if (!tasksBySubmissionId[subId]) {
      tasksBySubmissionId[subId] = [];
    }
    tasksBySubmissionId[subId].push({
      objectId: task.id,
      ...task.attributes,
    });
  });

  return results.map(({ id, attributes }) => ({
    objectId: id,
    ...attributes,
    tasks: tasksBySubmissionId[id] || [],
  }));
}
