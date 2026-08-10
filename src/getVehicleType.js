import { createSession } from 'wreq-js';

// Lazily-created persistent session reused across calls.
// Firefox TLS impersonation is needed to bypass Cloudflare anti-bot
// detection on api.lookupaplate.com. The session is shared so that
// subsequent requests reuse the same TLS session cache and cookies,
// which reduces the chance of being challenged.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = createSession({ browser: 'firefox_151', os: 'macos' });
  }
  return sessionPromise;
}

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default async function getVehicleType({ licensePlate, licenseState }) {
  const url = `https://api.lookupaplate.com/api/v1/wait_for_vehicle_details/${licenseState}/${licensePlate}/`;

  console.time(url); // eslint-disable-line no-console

  const session = await getSession();

  try {
    const res = await session.fetch(url, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://lookupaplate.com/',
      },
    });

    if (!res.ok) {
      throw new Error(`LookupAPlate returned ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
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
