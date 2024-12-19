import axios from 'axios';
import usStateNames from 'datasets-us-states-abbr-names'

usStateNames.DC = 'District of Columbia';

export function vehicleTypeUrl({ licensePlate, licenseState }) {
  const stateName = usStateNames[licenseState].toLowerCase().replace(' ', '-');

  return `https://www.lookupaplate.com/${stateName}/${licensePlate}/`
  // return `https://www.faxvin.com/license-plate-lookup/result?plate=${licensePlate}&state=${licenseState}`;
}

// await fetch("https://www.lookupaplate.com/new-york/TEST/", {
//     "credentials": "omit",
//     "headers": {
//         "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
//         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
//         "Accept-Language": "en-US,en;q=0.5",
//         "Sec-GPC": "1",
//         "Upgrade-Insecure-Requests": "1",
//         "Sec-Fetch-Dest": "document",
//         "Sec-Fetch-Mode": "navigate",
//         "Sec-Fetch-Site": "none",
//         "Sec-Fetch-User": "?1",
//         "Priority": "u=0, i"
//     },
//     "method": "GET",
//     "mode": "cors"
// });

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = vehicleTypeUrl({ licensePlate, licenseState });

  console.time(url); // eslint-disable-line no-console

  return axios.get('https://www.lookupaplate.com/new-york/TEST/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Sec-GPC': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Priority': 'u=0, i'
    }
  }).then(({ data }) => {
      console.log({ bmw: data.includes('BMW') });
      console.log({ data });
      return { result: data };

      /* return { */
      /*   result: { */
      /*     vehicleYear: data.quickVinResults[0].year, */
      /*     vehicleMake: data.quickVinResults[0].make, */
      /*     vehicleModel: data.quickVinResults[0].model, */
      /*     vehicleBody: undefined, */
      /*     licensePlate, */
      /*     licenseState, */
      /*   }, */
      /* }; */
    });

  return axios.get('https://www.lookupaplate.com/new-york/TEST/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Sec-GPC': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Priority': 'u=0, i'
    }
  })
    .then(({ data }) => {
      console.log({ data });
      console.timeEnd(url); // eslint-disable-line no-console

      return {
        result: {
          vehicleYear: data.quickVinResults[0].year,
          vehicleMake: data.quickVinResults[0].make,
          vehicleModel: data.quickVinResults[0].model,
          vehicleBody: undefined,
          licensePlate,
          licenseState,
        },
      };
    });
}
