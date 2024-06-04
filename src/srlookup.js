import axios from 'axios';
import { JSDOM } from 'jsdom';

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

  return result;
}
