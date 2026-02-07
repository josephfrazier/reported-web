import axios from 'axios';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default async function getVehicleType({ licensePlate, licenseState }) {
  const url = `https://api.lookupaplate.com/api/v1/wait_for_vehicle_details/${licenseState}/${licensePlate}/`;

  console.time(url); // eslint-disable-line no-console

  try {
    const { data } = await axios.get(url, {
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
    });

    const vehicleJson = data.vehicle_json || {};

    return {
      result: {
        vehicleYear: vehicleJson['29'] || undefined,
        vehicleMake: vehicleJson['26'] || undefined,
        vehicleModel: vehicleJson['28'] || undefined,
        vehicleBody: vehicleJson['5'] || undefined,
        licensePlate,
        licenseState,
      },
    };
  } finally {
    console.timeEnd(url); // eslint-disable-line no-console
  }
}
