/**
 * @jest-environment node
 *
 * Runs against a real Parse Server 2.8.4 (the version prod runs) backed by a
 * real MongoDB 4.4 started in-memory by mongodb-memory-server, so the actual
 * save/ACL/file-upload semantics are exercised instead of a fake.
 */

import net from 'net';

import Parse from 'parse/node';
import createSubmission from './createSubmission.js';

const { MongoMemoryServer } = require('mongodb-memory-server');
// parse-server is deliberately installed on demand instead of being a project
// dependency (see jest.globalSetup.js)
const { ParseServer } = require('parse-server');

// In-memory stand-in for a files adapter: the submission logic under test
// only cares that Parse.File#save() succeeds and produces a URL, not where
// the bytes are stored, and the real GridStore adapter opens its own MongoDB
// connection that nothing shuts down (keeping the test process alive after
// the run).
class InMemoryFilesAdapter {
  constructor() {
    this.files = new Map();
  }

  createFile(filename, data) {
    this.files.set(filename, data);
    return Promise.resolve();
  }

  deleteFile(filename) {
    this.files.delete(filename);
    return Promise.resolve();
  }

  getFileData(filename) {
    return Promise.resolve(this.files.get(filename));
  }

  // eslint-disable-next-line class-methods-use-this
  getFileLocation(config, filename) {
    return `${config.mount}/files/${config.applicationId}/${encodeURIComponent(filename)}`;
  }
}

// parse-server skips its cloud/URL verification (and test-unfriendly process
// listeners) when TESTING is set. Must be set before it is constructed.
process.env.TESTING = '1';

jest.setTimeout(30000);

const email = 'test@example.com';

// The module mutates process.env.TZ (and only restores it on the future-
// timestamp error path, matching the prod handler it was extracted from), so
// restore it between tests to keep them independent.
const originalTZ = process.env.TZ;

// Minimal 1x1 PNG and a minimal mp4 `ftyp` box, both small enough to inline
// while still being recognized by the file-type detector.
const pngBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const mp4Buffer = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), // box size
  Buffer.from('ftypisom'), // ftyp + major brand isom
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2'),
]);

describe('createSubmission', () => {
  let mongo;
  let parseServer;
  let user;
  let saveUser;

  beforeAll(async () => {
    // MongoDB 4.4 is the newest version whose wire protocol parse-server
    // 2.8.4's bundled mongodb driver can talk to. Note: the binary must be
    // downloaded once (mongodb-memory-server caches it), and on Ubuntu 24+
    // mongod 4.4 needs libssl1.1 installed.
    mongo = await MongoMemoryServer.create({ binary: { version: '4.4.14' } });

    // create() can resolve a moment before mongod accepts connections;
    // parse-server connects to it in its constructor, so wait until the
    // port actually accepts a TCP connection.
    const { port } = new URL(mongo.getUri());
    const attemptConnection = (resolve, reject, attempts) => {
      const socket = net.connect(Number(port), '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (attempts < 100) {
          setTimeout(
            () => attemptConnection(resolve, reject, attempts + 1),
            50,
          );
        } else {
          reject(new Error('mongod never accepted connections'));
        }
      });
    };
    await new Promise((resolve, reject) => {
      attemptConnection(resolve, reject, 0);
    });

    parseServer = ParseServer.start(
      {
        databaseURI: mongo.getUri(),
        appId: 'test-app',
        masterKey: 'test-master',
        // Only used as a placeholder; the client points at the real port.
        serverURL: 'http://localhost/parse',
        mountPath: '/parse',
        port: 0,
        verbose: false,
        filesAdapter: new InMemoryFilesAdapter(),
      },
      () => {},
    );
    await new Promise((resolve, reject) => {
      parseServer.server.once('listening', resolve);
      parseServer.server.once('error', reject);
    });
    // parse-server initializes its own nested parse SDK; ours needs it too.
    // The master key is passed like prod's Parse.initialize() does, so that
    // submission.save(null) and Parse.File#save() are authorized the same way.
    Parse.initialize('test-app', undefined, 'test-master');
    Parse.serverURL = `http://localhost:${parseServer.server.address().port}/parse`;

    user = new Parse.User();
    user.setUsername(email);
    user.setPassword('test-password');
    await user.signUp();
  });

  afterAll(async () => {
    await new Promise(resolve => parseServer.server.close(resolve));
    parseServer.handleShutdown();
    await mongo.stop();
  });

  beforeEach(() => {
    // Stand-in for server.js's saveUser, which logs the user in (or creates
    // them) and resolves to the Parse user.
    saveUser = jest.fn(() => Promise.resolve(user));
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  const validParams = overrides => ({
    saveUser,
    email,
    password: 'test-password',
    FirstName: 'Test',
    LastName: 'User',
    Phone: '5551234567',
    testify: true,
    plate: 'ABC1234',
    licenseState: 'NY',
    typeofreport: 'complaint',
    typeofcomplaint: 'Blocked the bike lane',
    reportDescription: 'Blocking the lane',
    can_be_shared_publicly: true,
    latitude: 40.7128,
    longitude: -74.006,
    formatted_address: 'New York, NY',
    CreateDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    attachmentData: [],
    versionNumber: 123,
    ...overrides,
  });

  test('saves the form fields onto the submission, ACLed to the user', async () => {
    const submission = await createSubmission(validParams());

    expect(saveUser).toHaveBeenCalledWith({
      email,
      password: 'test-password',
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
    });
    expect(submission.id).toBeDefined();
    expect(submission.toJSON()).toMatchObject({
      FirstName: 'Test',
      LastName: 'User',
      Phone: '5551234567',
      testify: true,
      Username: email,
      typeofreport: 'complaint',
      selectedReport: 1,
      colorTaxi: 'Black',
      medallionNo: 'ABC1234',
      license: 'ABC1234',
      state: 'NY',
      typeofcomplaint: 'Blocked the bike lane',
      passenger: false,
      locationNumber: 1,
      latitude: '40.7128',
      longitude: '-74.006',
      latitude1: 40.7128,
      longitude1: -74.006,
      loc1_address: 'New York, NY',
      reportDescription: 'Blocking the lane',
      can_be_shared_publicly: true,
      status: 0,
      operating_system: 'web',
      version_number: 123,
      reqnumber: 'N/A until submitted to 311',
    });
    expect(submission.toJSON().user).toMatchObject({
      __type: 'Object',
      className: '_User',
      objectId: user.id,
    });
    expect(submission.toJSON().timeofreport).toMatchObject({
      __type: 'Date',
    });
  });

  test('marks non-complaint reports differently via selectedReport', async () => {
    const submission = await createSubmission(
      validParams({ typeofreport: 'compliment' }),
    );

    expect(submission.get('selectedReport')).toBe(0);
  });

  test('rejects submissions missing a required field', async () => {
    await expect(
      createSubmission(validParams({ plate: '' })),
    ).rejects.toMatchObject({ message: 'plate is required' });
  });

  test('rejects timestamps in the future, restoring the previous timezone', async () => {
    await expect(
      createSubmission(
        validParams({
          CreateDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Timestamp cannot be in the future'),
    });
    expect(process.env.TZ).toBe(originalTZ);
  });

  test('uploads images as Parse Files under photoDataN and videos as URLs under videoDataN', async () => {
    const submission = await createSubmission(
      validParams({
        attachmentData: [{ buffer: pngBuffer }, { buffer: mp4Buffer }],
      }),
    );

    // The files controller prefixes stored file names with a hash, so match
    // the suffix instead of the exact name.
    expect(submission.toJSON().photoData0).toMatchObject({
      __type: 'File',
      name: expect.stringMatching(/_photoData0\.png$/),
    });
    expect(submission.toJSON().videoData0).toEqual(
      expect.stringContaining('videoData0.mp4'),
    );
  });

  test('keeps only the first 3 images (does not save 4th as videoData0)', async () => {
    const submission = await createSubmission(
      validParams({
        attachmentData: [1, 2, 3, 4].map(() => ({ buffer: pngBuffer })),
      }),
    );

    const json = submission.toJSON();
    expect(json.photoData0).toBeDefined();
    expect(json.photoData1).toBeDefined();
    expect(json.photoData2).toBeDefined();
    expect(json.photoData3).toBeUndefined();
    expect(json.videoData0).toBeUndefined();
  });
});
