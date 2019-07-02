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

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  let caughtError;
  page.on('error', error => {
    caughtError = error;
  });

  // Don't bother loading images, styles, or fonts. https://github.com/GoogleChrome/puppeteer/issues/1913#issuecomment-361224733
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

  await page.evaluate(() => {
    document.querySelector('#nextPage').click();
  });

  console.info('starting form');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  const humanDate = strftime('%a, %b %d at %I:%M %p', submission_date);
  const formDate = strftime('%D %r', submission_date);
  await page.evaluate(
    ({
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
    ({
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
    ({
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

  await page.evaluate(() => {
    document.querySelector('#CONFIRMATION').click();
  });

  console.info('submitted, waiting for result');
  await page.waitForFunction(
    () =>
      document.querySelector('.green_bold') &&
      document
        .querySelector('.green_bold')
        .innerText.includes('Your Service Request was submitted'),
  );

  // make sure to dump the html from the submitted page so you can regex it
  // https://reportedcab.slack.com/archives/C85007FUY/p1534693301000100
  // https://github.com/GoogleChrome/puppeteer/issues/331#issuecomment-323018788
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);

  let serviceRequestNumber = bodyHtml.match(/\d-\d-\d{10}/);
  serviceRequestNumber =
    (serviceRequestNumber && serviceRequestNumber[0]) || 'Emailed by 311';

  if (caughtError) {
    throw caughtError;
  }

  return { serviceRequestNumber, bodyHtml };
}

// ported from https://github.com/jeffrono/Reported/blob/47d4c6b401d0bf63a21494a762c3e664c9523abd/v2/hashes.rb#L1-L73
function complaintUrls() {
  const complaint_urls = {};

  // yellow
  complaint_urls.Yellow = {};
  complaint_urls.Yellow['Was on a cell phone'] =
    'TLC+Taxi+Driver+Cell+Phone+Use+Passenger';
  complaint_urls.Yellow['Used phone while driving'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Overcharges, demands tips, or does not use E-Z Pass'] =
    'TLC+Taxi+Driver+Fare+Tip';
  complaint_urls.Yellow['Refuses a credit card'] =
    'TLC+Taxi+Driver+Refused+Credit+Card';
  complaint_urls.Yellow['Refuses passenger requests'] =
    'TLC+Taxi+Driver+Denied+Request';
  complaint_urls.Yellow['Refused my requests'] =
    'TLC+Taxi+Driver+Denied+Request';
  complaint_urls.Yellow['Is rude'] = 'TLC+Taxi+Driver+Discourteous';
  complaint_urls.Yellow['Drove recklessly'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger'; // 'TLC+Taxi+Driver+Unsafe+Driving+Passenger'
  complaint_urls.Yellow['Was speeding'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Passenger';
  complaint_urls.Yellow['Blocked the crosswalk'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Blocked the bike lane'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Refused to pick me up'] =
    'TLC+Taxi+Driver+Refused+Pick-Up';
  complaint_urls.Yellow['Is reckless or unsafe if you were not the passenger'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Was courteous, kind or polite'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Yellow['Went above and beyond to help'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Yellow['Fails to display a license'] =
    'TLC+Taxi+Driver+Complaint+Passenger';
  complaint_urls.Yellow['Drove aggressively'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Honked horn (no emergency)'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Failed to yield'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Failed to yield to pedestrian'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Parked illegally'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Yellow['Ran a red light or stop sign'] =
    'TLC+Taxi+Driver+Unsafe+Driving+Non-Passenger';

  // green
  complaint_urls.Green = {};
  complaint_urls.Green['Was on a cell phone'] =
    'TLC+Green+Taxi+Driver+Cell+Phone+Use+Passenger';
  complaint_urls.Green['Used phone while driving'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Overcharges, demands tips, or does not use E-Z Pass'] =
    'TLC+Green+Taxi+Driver+Fare+Tip';
  complaint_urls.Green['Refuses a credit card'] =
    'TLC+Green+Taxi+Driver+Refused+Credit+Card';
  complaint_urls.Green['Refuses passenger requests'] =
    'TLC+Green+Taxi+Driver+Denied+Request';
  complaint_urls.Green['Refused my requests'] =
    'TLC+Green+Taxi+Driver+Denied+Request';
  complaint_urls.Green['Is rude'] = 'TLC+Green+Taxi+Driver+Discourteous';
  complaint_urls.Green['Drove recklessly'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Passenger';
  complaint_urls.Green['Refused to pick me up'] =
    'TLC+Green+Taxi+Driver+Refused+Pick-Up';
  complaint_urls.Green['Is reckless or unsafe if you were not the passenger'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Takes a long route or refuses route requests'] =
    'TLC+Green+Taxi+Driver+Route';
  complaint_urls.Green['Was courteous, kind or polite'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Green['Went above and beyond to help'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Green['Blocked the crosswalk'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Drove aggressively'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Honked horn (no emergency)'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Failed to yield'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Failed to yield to pedestrian'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Blocked the bike lane'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Was speeding'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Parked illegally'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';
  complaint_urls.Green['Ran a red light or stop sign'] =
    'TLC+Green+Taxi+Driver+Unsafe+Driving+Non-Passenger';

  // black
  complaint_urls.Black = {};
  complaint_urls.Black['Was on a cell phone'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Used phone while driving'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Overcharges, demands tips, or does not use E-Z Pass'] =
    'TLC+FHV+Driver+Fare+Tip';
  complaint_urls.Black['Refuses a credit card'] =
    'TLC+FHV+Driver+Refused+Credit+Card';
  complaint_urls.Black['Refuses passenger requests'] =
    'TLC+FHV+Driver+Denied+Request';
  complaint_urls.Black['Refused my requests'] = 'TLC+FHV+Driver+Denied+Request';
  complaint_urls.Black['Is rude'] = 'TLC+FHV+Driver+Discourteous';
  complaint_urls.Black['Drove recklessly'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Was speeding'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Refused to pick me up'] =
    'TLC+FHV+Driver+Refused+Pick-Up';
  complaint_urls.Black['Is reckless or unsafe if you were not the passenger'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Blocked the crosswalk'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Drove aggressively'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Was courteous, kind or polite'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Black['Went above and beyond to help'] =
    'TLC+Taxi+Driver+Compliment';
  complaint_urls.Black['Honked horn (no emergency)'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Failed to yield'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Failed to yield to pedestrian'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Blocked the bike lane'] =
    'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Parked illegally'] = 'TLC+FHV+Driver+Unsafe+Driving';
  complaint_urls.Black['Ran a red light or stop sign'] =
    'TLC+FHV+Driver+Unsafe+Driving';

  return complaint_urls;
}

// ported from https://github.com/jeffrono/Reported/blob/47d4c6b401d0bf63a21494a762c3e664c9523abd/v2/hashes.rb#L76
const base_url = 'https://portal.311.nyc.gov/article/?kanumber=KA-01244';

// ported from https://github.com/jeffrono/Reported/blob/47d4c6b401d0bf63a21494a762c3e664c9523abd/v2/task_311_submission.rb#L3
async function submit_311_report({
  colorTaxi,
  passenger,
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

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  // Don't bother loading images, styles, or fonts. https://github.com/GoogleChrome/puppeteer/issues/1913#issuecomment-361224733
  // TODO uncomment?
  // await page.setRequestInterception(true);
  // page.on('request', request => {
  //   if (
  //     ['image', 'stylesheet', 'font'].indexOf(request.resourceType()) !== -1
  //   ) {
  //     request.abort();
  //   } else {
  //     request.continue();
  //   }
  // });

  page.setViewport({
    width: 1000,
    height: 1000,
  });
  await page.goto(base_url);

  await page.evaluate(() => {
    document
      .querySelector(
        '[value="Report reckless car service driving if you were NOT a passenger."]',
      )
      .click();
  });

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  const humanDate = strftime('%a, %b %d at %I:%M %p', submission_date);
  const formDate = strftime('%-m/%-d/%Y %-I:%M %p', submission_date);
  await page.type('[aria-labelledby="n311_datetimeobserved_label"]', formDate);
  await page.evaluate(
    ({
      typeofcomplaint,
      humanDate,
      formDate,
      formal_description,
      medallionNo,
      photo_url_0,
      // photo_url_1,
      // photo_url_2,
    }) => {
      document.querySelector(
        '#n311_taximedallionnumber_name',
      ).value = medallionNo;
      document.querySelector('#n311_attendhearing_1').click();

      // fill in description of complaint

      // identify the timestamp at top of description
      let description = `THIS OCCURRED ON ${humanDate} - `;

      // TODO ensure `description` includes nature of violation (bike lane, cross walk, etc)

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

      document.querySelector('#n311_description').value = description;

      document.querySelector(
        '#n311_havecarservicenamephone',
      ).lastElementChild.selected = true;

      document.querySelector('#NextButton').click();
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

  await page.waitFor('#n311_additionallocationdetails');
  await page.evaluate(() =>
    document.querySelectorAll('.address-picker-btn.btn.btn-default')[1].click(),
  );
  const locationText = `${houseNumberIn} ${streetName1In}, ${firstBoroughName}`.toUpperCase();
  await page.waitFor('#address-search-box-input');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.type('#address-search-box-input', locationText);
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.evaluate(() => document.querySelector('#SelectButton').click());
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.evaluate(
    ({ latitude, longitude }) => {
      document.querySelector(
        '#n311_additionallocationdetails',
      ).value = `Exact lat/lng of incident (the address submitted is approximate): ${latitude}, ${longitude}.`;

      document.querySelector('#NextButton').click();
    },
    {
      latitude,
      longitude,
    },
  );

  console.info('filled complaint location');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  await page.evaluate(
    ({ Username, FirstName, LastName, Phone }) => {
      document.querySelector('#n311_contactemail').value = Username;
      document.querySelector('#n311_contactfirstname').value = FirstName;
      document.querySelector('#n311_contactlastname').value = LastName;
      document.querySelector('#n311_contactphone').value = Phone;

      const contactBorough = document.querySelector(
        '#n311_portalcustomeraddressborough',
      );
      const contactBoroughValue = Array.from(contactBorough.children).find(
        c => c.innerText.toUpperCase() === 'NOT WITHIN NEW YORK CITY',
      ).value;
      contactBorough.value = contactBoroughValue;

      document.querySelector('#n311_portalcustomeraddressline1').value = '-';
      document.querySelector('#n311_portalcustomeraddressstate').value = '-';
      document.querySelector('#n311_portalcustomeraddresscity').value = '-';
      document.querySelector('#n311_portalcustomeraddresszip').value = '-';

      document.querySelector('#NextButton').click();
    },
    {
      Username,
      FirstName,
      LastName,
      Phone,
    },
  );

  console.info('filled contact info');

  await page.waitForNavigation();
  await new Promise(resolve => setTimeout(resolve, 5000));

  await page.evaluate(() => {
    document.querySelector('#CONFIRMATION').click();
  });

  console.info('submitted, waiting for result');
  await page.waitForFunction(
    () =>
      document.querySelector('.green_bold') &&
      document
        .querySelector('.green_bold')
        .innerText.includes('Your Service Request was submitted'),
  );

  // make sure to dump the html from the submitted page so you can regex it
  // https://reportedcab.slack.com/archives/C85007FUY/p1534693301000100
  // https://github.com/GoogleChrome/puppeteer/issues/331#issuecomment-323018788
  const bodyHtml = await page.evaluate(() => document.body.innerHTML);

  let serviceRequestNumber = bodyHtml.match(/\d-\d-\d{10}/);
  serviceRequestNumber =
    (serviceRequestNumber && serviceRequestNumber[0]) || 'Emailed by 311';

  return { serviceRequestNumber, bodyHtml };
}

module.exports = {
  submit_311_illegal_parking_report,
  submit_311_report,
};
