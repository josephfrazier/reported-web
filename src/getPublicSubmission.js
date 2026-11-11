import Parse from 'parse/node';

// The fields the public map may show. Personal fields (name, phone, email)
// stay out of every public response, even though the master key can read them.
export const PUBLIC_SUBMISSION_FIELDS = [
  'location',
  'timeofreport',
  'license',
  'state',
  'typeofcomplaint',
  'loc1_address',
  'reqnumber',
  'photoData0',
  'photoData1',
  'photoData2',
  'can_be_shared_publicly',
];

export function publicSubmissionJson(object) {
  const json = object.toJSON();
  return {
    objectId: object.id,
    ...Object.fromEntries(
      PUBLIC_SUBMISSION_FIELDS.map(key => [key, json[key] ?? null]),
    ),
  };
}

const findByObjectId = async objectId => {
  const Submission = Parse.Object.extend('submission');
  const query = new Parse.Query(Submission);
  query.select(PUBLIC_SUBMISSION_FIELDS);
  try {
    return await query.get(objectId, { useMasterKey: true });
  } catch (error) {
    if (error.code === Parse.Error.OBJECT_NOT_FOUND) {
      return null;
    }
    throw error;
  }
};

const findByCaseId = async caseId => {
  const Task = Parse.Object.extend('tasks');
  const query = new Parse.Query(Task);
  query.equalTo('case_id', caseId);
  // If several tasks carry the same case id, the newest one names the
  // submission to show.
  query.descending('createdAt');
  // Task records carry no ACL, so this read needs no master key.
  const task = await query.first();
  const submission = task?.get('submission');
  if (!submission?.id) {
    return null;
  }
  return findByObjectId(submission.id);
};

const TASK_SUBMISSION_CHUNK = 5000;
const TASK_RESULT_LIMIT = 10000;

// Group task case IDs by submission id. One query over every polygon result
// can exceed the task query's 10,000-row limit, so query in submission
// chunks and page within a chunk when it still hits the limit.
export const caseIdsForSubmissions = async submissions => {
  const Task = Parse.Object.extend('tasks');
  const caseIds = new Map();

  for (
    let start = 0;
    start < submissions.length;
    start += TASK_SUBMISSION_CHUNK
  ) {
    const chunk = submissions.slice(start, start + TASK_SUBMISSION_CHUNK);
    let skip = 0;
    for (;;) {
      const query = new Parse.Query(Task);
      query.containedIn('submission', chunk);
      query.select('submission', 'case_id');
      query.limit(TASK_RESULT_LIMIT);
      query.skip(skip);
      // Task records carry no ACL, so this read needs no master key.
      // eslint-disable-next-line no-await-in-loop -- each page starts at the previous page's skip.
      const tasks = await query.find();

      for (const task of tasks) {
        const submissionId = task.get('submission')?.id;
        const caseId = task.get('case_id');
        if (submissionId && caseId) {
          if (!caseIds.has(submissionId)) {
            caseIds.set(submissionId, new Set());
          }
          caseIds.get(submissionId).add(caseId);
        }
      }

      if (tasks.length < TASK_RESULT_LIMIT) {
        break;
      }
      skip += tasks.length;
    }
  }

  return caseIds;
};

const caseIdsFor = async submission => {
  const caseIds = await caseIdsForSubmissions([submission]);
  return [...(caseIds.get(submission.id) || [])];
};

const isPublicOnMap = object =>
  object.get('can_be_shared_publicly') === true &&
  object.get('license') !== 'TEST' &&
  Boolean(object.get('location'));

// Resolve the identifier a map link uses to the submission the public map may
// show. A private, test, or missing submission all return null, so the caller
// cannot tell those cases apart.
export default async function getPublicSubmission({ objectId, caseId }) {
  const submission = objectId
    ? await findByObjectId(objectId)
    : await findByCaseId(caseId);
  if (!submission || !isPublicOnMap(submission)) {
    return null;
  }
  const json = publicSubmissionJson(submission);
  json.case_ids = await caseIdsFor(submission);
  return json;
}
