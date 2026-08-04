import axios from 'axios';

export async function geosearch({ lat, long }) {
  const { data } = await axios.get('https://geosearch.planninglabs.nyc/v2/reverse', {
    params: {
      'point.lat': lat,
      'point.lon': long,
      size: 1,
    },
  });

  return data;
}
