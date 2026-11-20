// Reverse geosearch can lead with a venue that has no housenumber, e.g.
// "72 PRECINCT STATIONHOUSE" for a point beside 834 FOURTH AVENUE. The
// address picker on portal.311.nyc.gov resolves street addresses only, so
// prefer the first result that has a housenumber. Keep the top result when
// no result has one.
const hasHousenumber = feature =>
  Boolean(String(feature.properties?.housenumber || '').trim());

export default function selectGeosearchFeature(features) {
  return features.find(hasHousenumber) || features[0];
}
