import axios from 'axios';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = `https://www.faxvin.com/license-plate-lookup/result?plate=${licensePlate}&state=${licenseState}`;

  console.time(url); // eslint-disable-line no-console

  return axios
    .get(url, {
      headers: {
        'accept-language': 'en-US,en;q=0.9',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.114 Safari/537.36',
      },
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
