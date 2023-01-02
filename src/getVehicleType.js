import axios from 'axios';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = `https://www.carfax.com/api/mobile-homepage-quickvin-check?plate=${licensePlate}&state=${licenseState}`;

  console.time(url); // eslint-disable-line no-console

  return axios
    .get(url, {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.5',
        Connection: 'keep-alive',
        Host: 'www.carfax.com',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': 1,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:108.0) Gecko/20100101 Firefox/108.0',
      },
    })
    .then(({ data }) => {
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
