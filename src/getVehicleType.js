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
//
// Switched from the deprecated REST endpoint (/api/v1/wait_for_vehicle_details/)
// to the current GraphQL API at /graphql.
export default async function getVehicleType({ licensePlate, licenseState }) {
  const url = 'https://api.lookupaplate.com/graphql';

  console.time(`getVehicleType ${licenseState}/${licensePlate}`); // eslint-disable-line no-console

  const session = await getSession();

  try {
    const res = await session.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: 'https://lookupaplate.com/',
      },
      body: JSON.stringify({
        query: `{
          licensePlate(licensePlate: "${licensePlate}", stateCode: "${licenseState}") {
            vehicle {
              make
              model
              year
            }
            vehicleJson
          }
        }`,
      }),
    });

    if (!res.ok) {
      throw new Error(`LookupAPlate returned ${res.status} ${res.statusText}`);
    }

    const { data } = await res.json();
    const lp = data?.licensePlate;
    const vehicle = lp?.vehicle || {};
    const vehicleJson = lp?.vehicleJson || {};

    return {
      result: {
        vehicleYear: vehicle.year || vehicleJson['29'] || undefined,
        vehicleMake: vehicle.make || vehicleJson['26'] || undefined,
        vehicleModel: vehicle.model || vehicleJson['28'] || undefined,
        vehicleBody: vehicleJson['5'] || undefined,
        licensePlate,
        licenseState,
      },
    };
  } finally {
    console.timeEnd(`getVehicleType ${licenseState}/${licensePlate}`); // eslint-disable-line no-console
  }
}
