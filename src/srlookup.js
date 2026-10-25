import https from 'https';
import axios from 'axios';
import { load } from 'cheerio';

export default async function srlookup({ reqnumber }) {
  const url = `https://portal.311.nyc.gov/sr-details/?srnum=${reqnumber}`;

  const { data } = await axios.get(url, {
    httpsAgent: new https.Agent({ keepAlive: false }),
  });
  // cheerio parses synchronously and holds no timers or handles of its own,
  // so unlike jsdom's JSDOM there is no window to close when we're done.
  const $ = load(data);

  const result = {};
  // Keep the previous optional-chaining behaviour: with no matching element
  // `description` is undefined, so the key is left out of the JSON response
  // rather than being sent as an empty string.
  const description = $('#page-wrapper p').first();
  result.description = description.length ? description.text() : undefined;
  const fields = $('.info, .control').toArray();
  for (let i = 0; i < fields.length; i += 2) {
    const keyField = $(fields[i]);
    const valueField = $(fields[i + 1]);

    const key = keyField.text();
    const value = valueField.text();

    result[key] = value;
  }

  const srdatereported =
    /\$\("#srdatereported"\).text\(getESTDate\("([^"]+)"\)\)/.exec(data);
  if (srdatereported) {
    result['Date Reported'] = new Date(srdatereported[1]).toLocaleString(
      'en-US',
      { timeZone: 'America/New_York' },
    );
  }

  const srupdatedon =
    /\$\("#srupdatedon"\).text\(getESTDate\("([^"]+)"\)\)/.exec(data);
  if (srupdatedon) {
    result['Updated On'] = new Date(srupdatedon[1]).toLocaleString('en-US', {
      timeZone: 'America/New_York',
    });
  }

  const srdateclosed =
    /\$\("#srdateclosed"\).text\(getESTDate\("([^"]+)"\)\)/.exec(data);
  if (srdateclosed) {
    result['Date Closed'] = new Date(srdateclosed[1]).toLocaleString('en-US', {
      timeZone: 'America/New_York',
    });
  }

  return result;
}
