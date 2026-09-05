import Parse from 'parse/node';
import { detectFromBuffer } from 'mime-bytes/file-type-detector';

import { isImage, isVideo } from './isImage.js';

// Extracted from server.js's /submit handler so the submission-creation
// logic can be tested against a real Parse Server without the surrounding
// HTTP/multer/coercion glue. `saveUser` and `versionNumber` are injected
// because they come from server.js's app configuration; the remaining params
// are the form fields, already coerced to their final types by the handler.
const createSubmission = async ({
  saveUser,
  email,
  password,
  FirstName,
  LastName,
  Phone,
  testify,
  plate,
  licenseState,
  typeofreport,
  typeofcomplaint,
  reportDescription,
  can_be_shared_publicly, // eslint-disable-line camelcase
  latitude,
  longitude,
  formatted_address, // eslint-disable-line camelcase
  CreateDate,
  attachmentData,
  versionNumber,
}) => {
  const timeofreport = new Date(CreateDate);
  const timeofreported = timeofreport;

  const user = await saveUser({
    email,
    password,
    FirstName,
    LastName,
    Phone,
    testify,
  });

  // make sure all required fields are present
  Object.entries({
    plate,
    licenseState,
    typeofcomplaint,
    latitude,
    longitude,
    CreateDate,
  }).forEach(([key, value]) => {
    if (!value) {
      throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
    }
  });

  const timezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  if (timeofreport.valueOf() > Date.now()) {
    const message = `Timestamp cannot be in the future (submitted time: ${timeofreport}, actual time: ${new Date()})`;
    // Assigning an undefined value would store the string "undefined", so
    // delete the variable instead when it was previously unset.
    if (timezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = timezone;
    }
    throw { message }; // eslint-disable-line no-throw-literal
  }

  const Submission = Parse.Object.extend('submission');
  const submission = new Submission();
  submission.set({
    user,

    FirstName,
    LastName,
    Phone,
    testify,

    Username: email,

    typeofreport,
    selectedReport: typeofreport === 'complaint' ? 1 : 0,
    colorTaxi: 'Black', // see https://reportedcab.slack.com/messages/C852Q265V/p1528474895000562
    medallionNo: plate,
    license: plate, // https://github.com/josephfrazier/Reported-Web/issues/23
    state: licenseState, // https://github.com/josephfrazier/Reported-Web/issues/23
    typeofcomplaint,
    passenger: false,
    locationNumber: 1,
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    latitude1: latitude,
    longitude1: longitude,
    location: new Parse.GeoPoint({ latitude, longitude }),
    loc1_address: formatted_address, // eslint-disable-line camelcase
    timeofreport,
    timeofreported,
    reportDescription,
    can_be_shared_publicly, // eslint-disable-line camelcase
    status: 0,
    operating_system: 'web',
    version_number: versionNumber,
    reqnumber: 'N/A until submitted to 311',
  });
  submission.setACL(new Parse.ACL(user));

  // upload attachments
  // http://docs.parseplatform.org/js/guide/#creating-a-parsefile

  const attachmentsWithFormats = await Promise.all(
    attachmentData.map(async ({ buffer: attachmentBuffer }) => ({
      attachmentBuffer,
      ext: (await detectFromBuffer(attachmentBuffer))?.name || 'jpg',
    })),
  );

  const images = attachmentsWithFormats.filter(isImage);
  const videos = attachmentsWithFormats.filter(isVideo);

  await Promise.all([
    ...images.slice(0, 3).map(async ({ attachmentBuffer, ext }, index) => {
      const key = `photoData${index}`;
      const file = new Parse.File(`${key}.${ext}`, {
        base64: attachmentBuffer.toString('base64'),
      });
      await file.save();
      submission.set(key, file);
    }),
    ...videos.slice(0, 3).map(async ({ attachmentBuffer, ext }, index) => {
      const key = `videoData${index}`;
      const file = new Parse.File(`${key}.${ext}`, {
        base64: attachmentBuffer.toString('base64'),
      });
      await file.save();
      submission.set(key, file.url());
    }),
  ]);
  return submission.save(null);
};

export default createSubmission;
