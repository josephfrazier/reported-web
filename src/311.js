/* eslint-disable camelcase */
/* eslint-disable no-shadow */
/* eslint-disable no-unused-vars */
/* eslint-disable prefer-rest-params */

// headless puppeteer submission proof-of-concept
// from https://reportedcab.slack.com/files/U9N03CAEM/FCB3SMUR1/headless_puppeteer_submission_proof-of-concept.js

const strftime = require('strftime');

// ported from https://github.com/jeffrono/Reported/blob/8cdc7efe6532aa0fd8b83ef0bcba083a14bcf52b/v2/task_311_illegal_parking_submission.rb
async function submit_311_illegal_parking_report({
  Username, // email
  typeofcomplaint,
  medallionNo,
  submission_timestamp,
  formal_description,
  photo_url_0,
  // photo_url_1,
  // photo_url_2,
  firstBoroughName,
  houseNumberIn,
  streetName1In,
  latitude,
  longitude,
  FirstName,
  LastName,
  Phone,
  Borough,
  Building,
  StreetName,
  Apt,
}) {
  const args = arguments[0];
  console.info(args);
  return args;
}

module.exports = {
  submit_311_illegal_parking_report,
};
