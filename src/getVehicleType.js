const axios = require('axios');

export function vehicleTypeUrl({ licensePlate, licenseState }) {
  return `https://www.carfax.com/api/mobile-homepage-quickvin-check?plate=${licensePlate}&state=${licenseState}`;
}

// ported from https://github.com/jeffrono/Reported/blob/19b588171315a3093d53986f9fb995059f5084b4/v2/enrich_functions.rb#L325-L346
export default function getVehicleType({ licensePlate, licenseState }) {
  const url = vehicleTypeUrl({ licensePlate, licenseState });

  console.time(url); // eslint-disable-line no-console

  return axios
    .get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Alt-Used': 'www.carfax.com',
        Connection: 'keep-alive',
        Cookie:
          'datadome=P4DhyQxRsHnufRFk6_p~IapRMG9Uk4_uAsTRiy0HzgtQRoMryslv1_EM6L0sp0m04MbtmbiEeMg_jeXV61cw4OdgmFcCM_8n5fp456S2ttWta~5i2psWkw_O3TIKP~IE',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        Priority: 'u=1',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        TE: 'trailers',
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
