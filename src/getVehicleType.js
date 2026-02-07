import https from 'https';
import axios from 'axios';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default async function getVehicleType({ licensePlate, licenseState }) {
  const logLabel = `getVehicleType(${licensePlate}, ${licenseState})`;

  console.time(logLabel); // eslint-disable-line no-console

  const url = `https://api.lookupaplate.com/api/v1/wait_for_vehicle_details/${licenseState}/${licensePlate}/`;
  const { data } = await axios.get(url, {
    httpsAgent: new https.Agent({ keepAlive: false }),
  });

  const v = data.vehicle_json || {};

  console.timeEnd(logLabel); // eslint-disable-line no-console

  return {
    result: {
      vehicleYear: v['29'] || undefined,
      vehicleMake: v['26'] || undefined,
      vehicleModel: v['28'] || undefined,
      vehicleBody: v['5'] || undefined,
      licensePlate,
      licenseState,
    },
  };
}
