/**
 * Submission management routes
 */

import assert from 'assert';
import Parse from 'parse/node';
import FileType from 'file-type/browser';
import { isImage, isVideo } from '../../isImage.js';
import handlePromiseRejection from '../middleware/errorHandler.js';
import { saveUser } from './users.js';
import upload from '../middleware/upload.js';

const { HEROKU_RELEASE_VERSION } = process.env;

/**
 * Get all submissions for a user
 * @param {object} req - Express request object
 * @returns {Promise<Array>} Array of submissions
 */
export async function getSubmissions(req) {
  return saveUser(req.body).then(user => {
    const Submission = Parse.Object.extend('submission');

    const usernameQuery = new Parse.Query(Submission);
    // Search by "Username" (email address) to show submissions made by all
    // users with the same email, since the web and mobile clients create
    // separate users
    usernameQuery.equalTo('Username', user.get('username'));
    usernameQuery.descending('timeofreport');
    usernameQuery.limit(Number.MAX_SAFE_INTEGER);

    // Also search by "email" since submissions from iOS clients don't always have this set
    const emailQuery = new Parse.Query(Submission);
    emailQuery.equalTo('email', user.get('username'));
    emailQuery.descending('timeofreport');
    emailQuery.limit(Number.MAX_SAFE_INTEGER);

    const query = Parse.Query.or(usernameQuery, emailQuery);
    query.descending('timeofreport');
    query.limit(Number.MAX_SAFE_INTEGER);
    return query.find();
  });
}

/**
 * Setup submission routes
 * @param {object} app - Express app
 */
export function setupSubmissionRoutes(app) {
  app.use('/submissions', (req, res) => {
    getSubmissions(req)
      .then(results => {
        const submissions = results.map(({ id, attributes }) => ({
          objectId: id,
          ...attributes,
        }));
        return submissions;
      })
      .then(submissions => {
        res.json({ submissions });
      })
      .catch(handlePromiseRejection(res));
  });

  app.use('/api/deleteSubmission', (req, res) => {
    const { objectId } = req.body;
    getSubmissions(req)
      .then(submissions => {
        const submission = submissions.find(sub => sub.id === objectId);
        assert(submission); // TODO make it obvious that this is necessary
        return submission.destroy().then(() => {
          res.json({ objectId });
        });
      })
      .catch(handlePromiseRejection(res));
  });

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
            process.env.TZ = timezone;
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
            loc1_address: formatted_address,
            timeofreport,
            timeofreported,
            reportDescription,
            can_be_shared_publicly,
            status: 0,
            operating_system: 'web',
            version_number: Number(HEROKU_RELEASE_VERSION.slice(1)),
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

  app.use('/api/categories', (req, res) => {
    const Category = Parse.Object.extend('Category');
    const query = new Parse.Query(Category);
    query
      .find()
      .then(results => {
        const categories = results.map(({ id, attributes }) => ({
          objectId: id,
          ...attributes,
        }));
        res.json({ categories });
      })
      .catch(handlePromiseRejection(res));
  });
}
