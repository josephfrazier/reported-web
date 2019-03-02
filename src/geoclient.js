import axios from 'axios';

const { GEO_APP_ID, GEO_APP_KEY, GOOGLE_API_KEY } = process.env;

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L149-L154
async function getCbData(id) {
  const url =
    'https://raw.githubusercontent.com/codebutler/59boards/fc7255aac18d67e08b4ae20c671540a6f80dc6e3/frontend/src/shared/data/districts-info.json';
  const { data: response } = await axios.get(url);
  return response[id];
}

// takes lat long
// returns hash with google response, geoclient response, and status
// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L91-L146
export async function validateLocation({ lat, long }) {
  const response = { lat, long };
  const GOOGLE_MAP_URL =
    'https://maps.googleapis.com/maps/api/geocode/json?latlng=';
  const url = `${GOOGLE_MAP_URL +
    lat},${long}&result_type=street_address&key=${GOOGLE_API_KEY}`;
  const { data: googleResponse } = await axios.get(url);

  // check if zero results
  if (googleResponse.status === 'ZERO_RESULTS') {
    console.log('zero results!'); // eslint-disable-line no-console
    response.google_response = googleResponse;
    response.geoclient_response = null;
    response.valid = false;
    return response;
  }

  const address = googleResponse.results[0];
  const building = address.address_components[0].short_name;
  const street = address.address_components[1].short_name;
  let borough;

  if (
    ['Brooklyn', 'Manhattan', 'Staten Island', 'Bronx', 'Queens'].includes(
      address.address_components[3].short_name,
    )
  ) {
    borough = address.address_components[3].short_name.toUpperCase();
  } else if (
    ['Brooklyn', 'Manhattan', 'Staten Island', 'Bronx', 'Queens'].includes(
      address.address_components[2].short_name,
    )
  ) {
    borough = address.address_components[2].short_name.toUpperCase();
  } else {
    borough = 'MANHATTAN';
  }

  const { data: geoclientResponse } = await axios.get(
    'https://api.cityofnewyork.us/geoclient/v1/address.json',
    {
      params: {
        houseNumber: building,
        street,
        borough,
        app_id: GEO_APP_ID,
        app_key: GEO_APP_KEY,
      },
    },
  );

  response.google_response = googleResponse;
  response.geoclient_response = geoclientResponse;

  if (geoclientResponse.address.message) {
    // then geoclient returned invalid data
    response.valid = false;
    console.log('not a valid address'); // eslint-disable-line no-console
  } else {
    // then geoclient returned VALID data!!
    response.valid = true;
    // get community board meta data
    const cbid = geoclientResponse.address.communityDistrict;
    response.cb_data = await getCbData(cbid);
  }

  return response;
}

// takes lat long
// spirals around that point, calling validateLocation until it succeeds
// returns hash with google response, geoclient response, and status
// ported from `process_validation` at https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L48-L88
export async function processValidation({ lat, long }) {
  lat = Number(lat); // eslint-disable-line no-param-reassign
  long = Number(long); // eslint-disable-line no-param-reassign

  const RADIUS = 0.0002; // https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/keys%20(template).rb#L35

  const response = [];

  // validate the location
  for (let i = 0; i <= 10; i += 1) {
    let r;
    // test version 1
    // eslint-disable-next-line no-await-in-loop
    r = await validateLocation({
      lat: lat + i * RADIUS,
      long,
    });
    if (r.valid) {
      response.push(r);
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    r = await validateLocation({
      lat: lat - i * RADIUS,
      long,
    });
    if (r.valid) {
      response.push(r);
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    r = await validateLocation({
      lat,
      long: long + i * RADIUS,
    });
    if (r.valid) {
      response.push(r);
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    r = await validateLocation({
      lat,
      long: long - i * RADIUS,
    });
    if (r.valid) {
      response.push(r);
      break;
    }
  }

  return response[0];
}
