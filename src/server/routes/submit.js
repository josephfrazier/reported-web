/**
 * Submit endpoint: /submit
 */

import FileType from 'file-type/browser';

import { isImage, isVideo } from '../../isImage.js';
import { handlePromiseRejection } from '../errorHandler';

/**
 * Validate that all required submission fields are present
 * @param {Object} fields - Object with required field values
 * @throws {Object} Error with message if field is missing
 */
export function validateSubmissionFields(fields) {
  Object.entries(fields).forEach(([key, value]) => {
    if (!value) {
      throw { message: `${key} is required` }; // eslint-disable-line no-throw-literal
    }
  });
}

/**
 * Validate that timestamp is not in the future
 * @param {Date} timeofreport - Submission timestamp
 * @throws {Object} Error with message if timestamp is in future
 */
export function validateTimestamp(timeofreport) {
  const timezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  if (timeofreport.valueOf() > Date.now()) {
    const message = `Timestamp cannot be in the future (submitted time: ${timeofreport}, actual time: ${new Date()})`;
    process.env.TZ = timezone;
    throw { message }; // eslint-disable-line no-throw-literal
  }
  process.env.TZ = timezone;
}

/**
 * Register submit route on Express app
 * @param {Object} app - Express app instance
 * @param {Object} options
 * @param {Object} options.authService - Auth service instance
 * @param {Object} options.Parse - Parse SDK instance
 * @param {Object} options.upload - Multer upload instance
 * @param {string} options.herokuReleaseVersion - HEROKU_RELEASE_VERSION env var
 */
export function registerSubmitRoute(
  app,
  { authService, Parse, upload, herokuReleaseVersion },
) {
  const { saveUser } = authService;

  app.use('/submit', (req, res) => {
    // Call upload.array directly to intercept errors and respond with JSON, see the following:
    // https://github.com/expressjs/multer/tree/80ee2f52432cc0c81c93b03c6b0b448af1f626e5#error-handling
    upload.array('attachmentData[]')(req, res, error => {
      if (error) {
        // Make error.message enumerable so it gets sent to the client
        const { message } = error;
        handlePromiseRejection(res)({ ...error, message });
        return;
      }

      const {
        email,
        password,
        FirstName,
        LastName,
        Phone,
        testify: testifyString,

        plate,
        licenseState,
        typeofreport = 'complaint',
        typeofcomplaint,
        reportDescription,
        can_be_shared_publicly: can_be_shared_publiclyString, // eslint-disable-line camelcase
        latitude: latitudeString,
        longitude: longitudeString,
        formatted_address, // eslint-disable-line camelcase
        CreateDate,
      } = req.body;

      const testify = testifyString === 'true';
      const can_be_shared_publicly = can_be_shared_publiclyString === 'true'; // eslint-disable-line camelcase
      const latitude = Number(latitudeString);
      const longitude = Number(longitudeString);

      const attachmentData = req.files;

      const timeofreport = new Date(CreateDate);
      const timeofreported = timeofreport;

      saveUser({
        email,
        password,
        FirstName,
        LastName,
        Phone,
        testify,
      })
        .then(async user => {
          validateSubmissionFields({
            plate,
            licenseState,
            typeofcomplaint,
            latitude,
            longitude,
            CreateDate,
          });

          validateTimestamp(timeofreport);

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
            loc1_address: formatted_address,
            timeofreport,
            timeofreported,
            reportDescription,
            can_be_shared_publicly,
            status: 0,
            operating_system: 'web',
            version_number: Number(herokuReleaseVersion.slice(1)),
            reqnumber: 'N/A until submitted to 311',
          });
          submission.setACL(new Parse.ACL(user));

          // upload attachments
          // http://docs.parseplatform.org/js/guide/#creating-a-parsefile

          const attachmentsWithFormats = await Promise.all(
            attachmentData.map(async ({ buffer: attachmentBuffer }) => ({
              attachmentBuffer,
              ext: (await FileType.fromBuffer(attachmentBuffer)).ext,
            })),
          );

          const images = attachmentsWithFormats.filter(isImage);
          const videos = attachmentsWithFormats.filter(isVideo);

          await Promise.all([
            ...images
              .slice(0, 3)
              .map(async ({ attachmentBuffer, ext }, index) => {
                const key = `photoData${index}`;
                const file = new Parse.File(`${key}.${ext}`, [
                  ...attachmentBuffer,
                ]);
                await file.save();
                submission.set(key, file);
              }),
            ...videos
              .slice(0, 3)
              .map(async ({ attachmentBuffer, ext }, index) => {
                const key = `videoData${index}`;
                const file = new Parse.File(`${key}.${ext}`, [
                  ...attachmentBuffer,
                ]);
                await file.save();
                submission.set(key, file.url());
              }),
          ]);
          return submission.save(null);
        })
        .then(submission => {
          // Unwrap encoded Date objects into ISO strings
          // before: { __type: 'Date', iso: '2018-05-26T23:17:22.000Z' }
          // after: '2018-05-26T23:17:22.000Z'
          const submissionValue = submission.toJSON();
          submissionValue.timeofreport = submissionValue.timeofreport.iso;
          submissionValue.timeofreported = submissionValue.timeofreported.iso;

          console.info({ submission: submissionValue });

          res.json({ submission: submissionValue });
        })
        .catch(handlePromiseRejection(res));
    });
  });
}
