import axios from 'axios';
import mem from 'mem';

const GEOSEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/reverse';
const PAD_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';

// The city's Property Address Directory (PAD) provides the official address
// for each BBL, e.g. https://data.cityofnewyork.us/resource/64uk-42ks.json?bbl=3001940042
// returns 146 HOYT STREET. Cache lookups for a day, since addresses rarely
// change and nearby submissions often share a BBL.
const getPadAddress = mem(
  async bbl => {
    const { data } = await axios.get(PAD_URL, {
      params: { bbl },
      timeout: 5000,
    });
    return data[0]?.address;
  },
  {
    cachePromiseRejection: false,
    maxAge: 24 * 60 * 60 * 1000,
  },
);

// Geosearch can return several results for the same point that all share a
// BBL, e.g. corner lots have an address on each street, and some street
// names are misspelled (BERGAN vs BERGEN). Prefer the result matching the
// PAD's official address for that BBL, falling back to the top result.
export async function selectCanonicalFeature(features, getPadAddressForBbl) {
  const [firstFeature] = features;
  if (!firstFeature) {
    return undefined;
  }

  const bbl = firstFeature.properties.addendum?.pad?.bbl;
  if (!bbl) {
    return firstFeature;
  }

  let padAddress;
  try {
    padAddress = await getPadAddressForBbl(bbl);
  } catch (error) {
    // PAD is best-effort: fall back to the top result if it's unavailable
    console.error(error);
    return firstFeature;
  }
  if (!padAddress) {
    return firstFeature;
  }

  return (
    features.find(
      feature =>
        feature.properties.addendum?.pad?.bbl === bbl &&
        feature.properties.name?.toUpperCase() === padAddress.toUpperCase(),
    ) || firstFeature
  );
}

export async function geosearch({ lat, long }) {
  const { data } = await axios.get(GEOSEARCH_URL, {
    params: {
      'point.lat': lat,
      'point.lon': long,
      // Ask for more than one result so that selectCanonicalFeature has
      // candidates sharing the top result's BBL to choose from
      size: 20,
    },
  });

  if (!data.features.length) {
    return data;
  }

  const feature = await selectCanonicalFeature(data.features, getPadAddress);

  return {
    ...data,
    features: [feature],
  };
}
