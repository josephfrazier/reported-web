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

const caseIdsFor = async submission => {
  const Task = Parse.Object.extend('tasks');
  const query = new Parse.Query(Task);
  query.equalTo('submission', submission);
  query.select('case_id');
  query.ascending('createdAt');
  query.limit(1000);
  // Task records carry no ACL, so this read needs no master key.
  const tasks = await query.find();
  return [...new Set(tasks.map(task => task.get('case_id')).filter(Boolean))];
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
