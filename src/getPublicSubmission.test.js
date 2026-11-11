/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 9.4.0 backed by a real MongoDB 4.4 started
 * in-memory by mongodb-memory-server, so the actual lookup, pointer join, and
 * field-selection semantics are exercised instead of a fake.
 */

import Parse from 'parse/node';

import getPublicSubmission from './getPublicSubmission.js';
import startRealParseServer from './testUtils/realParseServer.js';

jest.setTimeout(30000);

describe('getPublicSubmission', () => {
  let stopParseServer;
  let publicSubmission;
  let privateSubmission;
  let testLicenseSubmission;
  let noLocationSubmission;

  beforeAll(async () => {
    const { stop } = await startRealParseServer({
      masterKey: 'test-master',
      // parse-server 5+ defaults client class creation to off. These tests
      // save `submission`/`tasks` objects as an ordinary client, and in
      // production both classes already exist in the schema.
      serverOptions: { allowClientClassCreation: true },
    });
    stopParseServer = stop;

    const Submission = Parse.Object.extend('submission');
    const saveSubmission = async fields => {
      const submission = new Submission();
      Object.entries(fields).forEach(([key, value]) => {
        submission.set(key, value);
      });
      await submission.save();
      return submission;
    };

    publicSubmission = await saveSubmission({
      location: new Parse.GeoPoint({ latitude: 40.686, longitude: -73.979 }),
      typeofcomplaint: 'Blocked the crosswalk',
      license: 'ABC1234',
      state: 'NY',
      loc1_address: '64 Flatbush Ave, Brooklyn',
      timeofreport: new Date('2026-09-03T15:00:00.000Z'),
      reqnumber: '311-12345',
      can_be_shared_publicly: true,
      // Personal fields must never reach a public response.
      FirstName: 'Test',
      Phone: '555-555-5555',
      email: 'test@example.com',
    });

    privateSubmission = await saveSubmission({
      location: new Parse.GeoPoint({ latitude: 40.7, longitude: -73.99 }),
      can_be_shared_publicly: false,
    });

    testLicenseSubmission = await saveSubmission({
      location: new Parse.GeoPoint({ latitude: 40.71, longitude: -73.98 }),
      license: 'TEST',
      can_be_shared_publicly: true,
    });

    noLocationSubmission = await saveSubmission({
      can_be_shared_publicly: true,
    });

    const Task = Parse.Object.extend('tasks');
    const saveTask = async ({ submission, caseId }) => {
      const task = new Task();
      task.set('submission', submission);
      // The Parse field is named in snake_case, like prod's task records.
      task.set('case_id', caseId);
      await task.save();
      return task;
    };

    await saveTask({ submission: publicSubmission, caseId: '311-12345' });
    await saveTask({ submission: privateSubmission, caseId: '311-99999' });
    await saveTask({
      submission: noLocationSubmission,
      caseId: '311-88888',
    });
  });

  afterAll(() => stopParseServer());

  test('returns a publicly shareable submission by objectId', async () => {
    const result = await getPublicSubmission({
      objectId: publicSubmission.id,
    });

    expect(result).toMatchObject({
      objectId: publicSubmission.id,
      typeofcomplaint: 'Blocked the crosswalk',
      license: 'ABC1234',
      state: 'NY',
      loc1_address: '64 Flatbush Ave, Brooklyn',
      reqnumber: '311-12345',
      can_be_shared_publicly: true,
    });
    expect(result.location).toMatchObject({
      latitude: 40.686,
      longitude: -73.979,
    });
    expect(result).not.toHaveProperty('FirstName');
    expect(result).not.toHaveProperty('Phone');
    expect(result).not.toHaveProperty('email');
  });

  test('returns null for a submission that is not publicly shareable', async () => {
    await expect(
      getPublicSubmission({ objectId: privateSubmission.id }),
    ).resolves.toBeNull();
  });

  test('returns null for a submission with the TEST license', async () => {
    await expect(
      getPublicSubmission({ objectId: testLicenseSubmission.id }),
    ).resolves.toBeNull();
  });

  test('returns null for a submission without a location', async () => {
    await expect(
      getPublicSubmission({ objectId: noLocationSubmission.id }),
    ).resolves.toBeNull();
  });

  test('returns null for an unknown objectId', async () => {
    await expect(
      getPublicSubmission({ objectId: 'aaaaaaaaaa' }),
    ).resolves.toBeNull();
  });

  test('finds a publicly shareable submission by a task case id', async () => {
    const result = await getPublicSubmission({ caseId: '311-12345' });

    expect(result.objectId).toBe(publicSubmission.id);
  });

  test('returns null when the case id belongs to a non-public submission', async () => {
    await expect(
      getPublicSubmission({ caseId: '311-99999' }),
    ).resolves.toBeNull();
  });

  test('returns null when the case id belongs to a submission without a location', async () => {
    await expect(
      getPublicSubmission({ caseId: '311-88888' }),
    ).resolves.toBeNull();
  });

  test('returns null for an unknown case id', async () => {
    await expect(
      getPublicSubmission({ caseId: '311-00000' }),
    ).resolves.toBeNull();
  });
});
