import { JSDOM } from 'jsdom';

const axios = require('axios');

export default async function srlookup({ reqnumber }) {
  const url = `https://portal.311.nyc.gov/sr-details/?srnum=${reqnumber}`;

  const { data } = await axios.get(url);
  const { document } = new JSDOM(data).window;

  const result = {};
  result.description = document.querySelector('#page-wrapper p')?.textContent;
  const fields = [...document.querySelectorAll('.info, .control')];
  for (let i = 0; i < fields.length; i += 2) {
    const keyField = fields[i];
    const valueField = fields[i + 1];

    const key = keyField.textContent;
    const value = valueField.textContent;

    result[key] = value;
  }

  const srdatereported = /\$\("#srdatereported"\).text\(getESTDate\("([^"]+)"\)\)/.exec(
    data,
  );
  if (srdatereported) {
    result['Date Reported'] = new Date(
      srdatereported[1],
    ).toLocaleString('en-US', { timeZone: 'America/New_York' });
  }

  const srupdatedon = /\$\("#srupdatedon"\).text\(getESTDate\("([^"]+)"\)\)/.exec(
    data,
  );
  if (srupdatedon) {
    result['Updated On'] = new Date(srupdatedon[1]).toLocaleString('en-US', {
      timeZone: 'America/New_York',
    });
  }

  const srdateclosed = /\$\("#srdateclosed"\).text\(getESTDate\("([^"]+)"\)\)/.exec(
    data,
  );
  if (srdateclosed) {
    result['Date Closed'] = new Date(srdateclosed[1]).toLocaleString('en-US', {
      timeZone: 'America/New_York',
    });
  }

  return result;
}
