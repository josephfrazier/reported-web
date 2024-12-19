import axios from 'axios';
import { JSDOM } from 'jsdom';
import vehicleTypeUrl from './vehicleTypeUrl.js';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = vehicleTypeUrl({ licensePlate, licenseState });

  console.time(url); // eslint-disable-line no-console

  return axios
    .get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        DNT: '1',
        'Sec-GPC': '1',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        Priority: 'u=0, i',
      },
    })
    .then(({ data }) => {
      const { document } = new JSDOM(data).window;

      return {
        result: {
          vehicleYear: document.querySelector(
            'div.collapse-arrow:nth-child(1) > div:nth-child(3) > div:nth-child(1) > div:nth-child(1) > div:nth-child(4) > div:nth-child(2)',
          )?.textContent,
          vehicleMake: document.querySelector(
            'div.collapse-arrow:nth-child(1) > div:nth-child(3) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2)',
          )?.textContent,
          vehicleModel: document.querySelector(
            'div.collapse-arrow:nth-child(1) > div:nth-child(3) > div:nth-child(1) > div:nth-child(1) > div:nth-child(3) > div:nth-child(2)',
          )?.textContent,
          vehicleBody: document.querySelector(
            'div.collapse-arrow:nth-child(3) > div:nth-child(3) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(2)',
          )?.textContent,
          licensePlate,
          licenseState,
        },
      };
    });
}
