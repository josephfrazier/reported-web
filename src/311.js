/* eslint-disable camelcase */
/* eslint-disable no-shadow */

// headless puppeteer submission proof-of-concept
// from https://reportedcab.slack.com/files/U9N03CAEM/FCB3SMUR1/headless_puppeteer_submission_proof-of-concept.js

const puppeteer = require('puppeteer');
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
  const submission_date = new Date(submission_timestamp);

  const browser = await puppeteer.launch({ headless: false }); // TODO change to true
  const page = await browser.newPage();

  // Don't bother loading images, styles, or fonts. https://github.com/GoogleChrome/puppeteer/issues/1913#issuecomment-361224733
  // TODO test whether it still works
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (
      ['image', 'stylesheet', 'font'].indexOf(request.resourceType()) !== -1
    ) {
      request.abort();
    } else {
      request.continue();
    }
  });

  page.setViewport({
    width: 1000,
    height: 1000,
  });
  await page.goto(
    'http://www1.nyc.gov/apps/311universalintake/form.htm?serviceName=NYPD+Parking',
  );

  await page.evaluate(async () => {
    document.querySelector('#nextPage').click();
  });

  console.info('starting form');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  const humanDate = strftime('%a, %b %d at %I:%M %p', submission_date);
  const formDate = strftime('%D %r', submission_date);
  await page.evaluate(
    async ({
      typeofcomplaint,
      humanDate,
      formDate,
      formal_description,
      medallionNo,
      photo_url_0,
      // photo_url_1,
      // photo_url_2,
    }) => {
      // select from list  (blocked bike lane, others)
      if (typeofcomplaint === 'Parked illegally') {
        const dropdownElement = document.querySelector('#descriptor1');
        const dropdownValue = Array.from(dropdownElement.children).find(
          c => c.innerText === 'Posted Parking Sign Violation',
        ).value;
        dropdownElement.value = dropdownValue;
      } else {
        const dropdownElement = document.querySelector('#descriptor1');
        const dropdownValue = Array.from(dropdownElement.children).find(
          c => c.innerText === 'Blocked Bike Lane',
        ).value;
        dropdownElement.value = dropdownValue;
      }

      // fill in description of complaint

      // identify the timestamp at top of description
      let description = `THIS OCCURRED ON ${humanDate} - `;

      // take first 400 characters
      description += formal_description.slice(0, 400);
      // .split.first().join(' ')
      description += `  License: ${medallionNo}. `;

      if (photo_url_0) {
        description += `Photo 1: ${photo_url_0}  `;
      }

      // if (photo_url_1) {
      //   description += `Photo 2: ${photo_url_1}  `
      // }

      // if (photo_url_2) {
      //   description += `Photo 3: ${photo_url_2}  `
      // }

      document.querySelector('#complaintDetails').value = description;

      // set date time
      document.querySelector('#dateTimeOfIncident').value = formDate;

      document.querySelector('#nextPage').click();
    },
    {
      typeofcomplaint,
      humanDate,
      formDate,
      formal_description,
      medallionNo,
      photo_url_0,
      // photo_url_1,
      // photo_url_2,
    },
  );

  console.info('filled complaint type/datetime/license/photo');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  await page.evaluate(
    async ({
      firstBoroughName,
      houseNumberIn,
      streetName1In,
      latitude,
      longitude,
    }) => {
      // set location
      const locationType = document.querySelector('#locationType');
      const locationTypeValue = Array.from(locationType.children).find(
        c => c.innerText === 'Street/Sidewalk',
      ).value;
      locationType.value = locationTypeValue;

      const incidentBorough6 = document.querySelector('#incidentBorough6');
      const incidentBorough6Value = Array.from(incidentBorough6.children).find(
        c => c.innerText === firstBoroughName.toUpperCase(),
      ).value;
      incidentBorough6.value = incidentBorough6Value;

      document.querySelector('#incidentAddressNumber').value = houseNumberIn;
      document.querySelector('#incidentStreetName').value = streetName1In;
      document.querySelector(
        '#locationDetails',
      ).value = `Exact lat/lng of incident (the address submitted is approximate): ${latitude}, ${longitude}.`;

      // click next
      document.querySelector('#nextPage').click();
    },
    {
      firstBoroughName,
      houseNumberIn,
      streetName1In,
      latitude,
      longitude,
    },
  );

  console.info('filled complaint location');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  await page.evaluate(
    async ({
      Username,
      FirstName,
      LastName,
      Phone,
      Borough,
      Building,
      StreetName,
      Apt,
    }) => {
      document.querySelector('#contactEmailAddress').value = Username;
      document.querySelector('#contactFirstName').value = FirstName;
      document.querySelector('#contactLastName').value = LastName;
      document.querySelector('#contactDaytimePhone').value = Phone;

      const contactBorough = document.querySelector('#contactBorough');
      const contactBoroughValue = Array.from(contactBorough.children).find(
        c => c.innerText === Borough.toUpperCase(),
      ).value;
      contactBorough.value = contactBoroughValue;

      document.querySelector('#contactAddressNumber').value = Building;
      document.querySelector('#contactStreetName').value = StreetName;
      document.querySelector('#contactApartment').value = Apt;

      document.querySelector('#nextPage').click();
    },
    {
      Username,
      FirstName,
      LastName,
      Phone,
      Borough,
      Building,
      StreetName,
      Apt,
    },
  );

  console.info('filled contact info');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  // XXX the following code submits the form!
  // /*
  await page.evaluate(async () => {
    document.querySelector('#CONFIRMATION').click();
  });

  console.info('submitted, waiting for result');
  await page.waitForFunction(() =>
    document
      .querySelector('.green_bold')
      .innerText.includes('Your Service Request was submitted'),
  );

  // make sure to dump the html from the submitted page so you can regex it
  // https://reportedcab.slack.com/archives/C85007FUY/p1534693301000100
  // https://github.com/GoogleChrome/puppeteer/issues/331#issuecomment-323018788
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  console.info({ bodyHtml });

  let serviceRequestNumber = bodyHtml.match(/\d-\d-\d{10}/);
  serviceRequestNumber =
    (serviceRequestNumber && serviceRequestNumber[0]) || 'Emailed by 311';

  return { serviceRequestNumber };
  // */
}

module.exports = {
  submit_311_illegal_parking_report,
};
