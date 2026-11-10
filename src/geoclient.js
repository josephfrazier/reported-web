import axios from 'axios';
import mem from 'mem';

import {
  geosearchCacheKey,
  readCachedGeosearch,
  writeCachedGeosearch,
} from './geosearchCache.js';
import normalizeAddress from './normalizeAddress.js';

const GEOSEARCH_URL = 'https://geosearch.planninglabs.nyc/v2/reverse';
const PAD_URL = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';

const PAD_RETRY_LIMIT = 3;
const PAD_RETRY_BASE_DELAY_MS = 250;

// PAD (Socrata) intermittently returns 503 ("Service unavailable") on
// filtered queries, so retry a few times with a short delay. Retries live
// inside the mem wrapper so a lookup that fails after every retry is not
// cached, and a later lookup retries again.
const getPadAddressData = (bbl, attempt = 1) =>
  axios
    .get(PAD_URL, {
      params: { bbl },
      timeout: 5000,
    })
    .catch(error => {
      if (error.response?.status !== 503 || attempt > PAD_RETRY_LIMIT) {
        throw error;
      }
      return new Promise(resolve =>
        setTimeout(resolve, PAD_RETRY_BASE_DELAY_MS * attempt),
      ).then(() => getPadAddressData(bbl, attempt + 1));
    });

// The city's Property Address Directory (PAD) provides the official address
// for each BBL, e.g. https://data.cityofnewyork.us/resource/64uk-42ks.json?bbl=3001940042
// returns 146 HOYT STREET. Cache lookups for a day, since addresses rarely
// change and nearby submissions often share a BBL.
export const getPadAddress = mem(
  async bbl => {
    const { data } = await getPadAddressData(bbl);
    return data[0]?.address;
  },
  {
    cachePromiseRejection: false,
    maxAge: 24 * 60 * 60 * 1000,
  },
);

// Geosearch results that carry an address use the venue and address layers;
// excluding the others (e.g. locality) prevents matching e.g. "Brooklyn"
// against a borough result when the user selected a neighborhood.
const ADDRESS_LAYERS = ['venue', 'address'];

const selectFeatureMatchingAddress = (features, selectedAddress) => {
  const normalizedSelectedAddress = normalizeAddress(selectedAddress);
  return features.find(
    feature =>
      ADDRESS_LAYERS.includes(feature.properties.layer) &&
      normalizeAddress(feature.properties.name) === normalizedSelectedAddress,
  );
};

// Geosearch can return several results for the same point that all share a
// BBL, e.g. corner lots have an address on each street, and some street
// names are misspelled (BERGAN vs BERGEN). When the user selected a search
// result, prefer the feature matching the selected address, since the user
// explicitly chose it; otherwise prefer the result matching the PAD's
// official address for the top result's BBL. Fall back to the top result.
export async function selectCanonicalFeature(
  features,
  getPadAddressForBbl,
  selectedAddress,
) {
  const [firstFeature] = features;
  if (!firstFeature) {
    return undefined;
  }

  if (selectedAddress) {
    const matchingFeature = selectFeatureMatchingAddress(
      features,
      selectedAddress,
    );
    if (matchingFeature) {
      return matchingFeature;
    }
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

async function fetchGeosearch({ lat, long, address }) {
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
    return {
      answer: { ...data, fellBackToTopResult: false },
      fellBackToTopResult: false,
    };
  }

  // The canonical feature can fall back to the top result when the city's
  // address directory cannot answer. That fallback answers this request but is
  // not an answer to keep, so the caller is told not to store it, and the
  // response says so to the page.
  let fellBackToTopResult = false;
  const feature = await selectCanonicalFeature(
    data.features,
    async bbl => {
      try {
        return await getPadAddress(bbl);
      } catch (error) {
        fellBackToTopResult = true;
        throw error;
      }
    },
    address,
  );

  return {
    answer: {
      ...data,
      features: [feature],
      fellBackToTopResult,
    },
    fellBackToTopResult,
  };
}

export async function geosearch({ lat, long, address }) {
  const cacheKey = geosearchCacheKey({ lat, long, address });

  const cached = await readCachedGeosearch(cacheKey);
  if (cached) {
    console.info('/api/geosearch answered from the cache');
    return cached;
  }

  const { answer, fellBackToTopResult } = await fetchGeosearch({
    lat,
    long,
    address,
  });

  // A fallback caused by the address directory being down is asked again next
  // time; only an answer the directory stood behind is kept.
  if (!fellBackToTopResult) {
    await writeCachedGeosearch(cacheKey, answer);
  }

  return answer;
}
