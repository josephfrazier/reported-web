import axios from 'axios';

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = `https://findbyplate.com/US/${licenseState}/${licensePlate}/`;

  console.time(url); // eslint-disable-line no-console
  return axios.get(url).then(({ data }) => {
    console.timeEnd(url); // eslint-disable-line no-console
    const vehicleSummary = data
      .match(/<h2 class="vehicle-modal">(.+?)</s)[1]
      .trim();
    const components = vehicleSummary.split(' ');
    const vehicleYear = components[0];
    let vehicleMake = components[1];
    vehicleMake =
      vehicleMake.charAt(0).toUpperCase() + vehicleMake.slice(1).toLowerCase();
    const vehicleModel = components.slice(2).join(' ');
    let vehicleBody;

    try {
      vehicleBody = data
        .match(/<div class="cell" data-title="BodyClass">(.+?)</s)[1]
        .trim();
    } catch (err) {
      console.error('no vehicle body');
    }

    // if (vehicleYear === 'Try Members Area') {
    //   const message = 'not found';
    //   throw { message, licensePlate, licenseState }; // eslint-disable-line no-throw-literal
    // }

    return {
      result: {
        vehicleYear,
        vehicleMake,
        vehicleModel,
        vehicleBody,
        licensePlate,
        licenseState,
      },
    };
  });
}
