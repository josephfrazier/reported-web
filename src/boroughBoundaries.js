// The borough boundaries GeoJSON used for NYC location validation. It
// combines:
// - DCP's "Borough Boundaries (water areas included)" layer, which covers
//   land plus the surrounding waterways, so points over water (on bridges,
//   ferries, etc.) count as inside NYC.
// - "shoreline slivers": the thin strips of land the generalized
//   water-areas-included layer leaves uncovered, computed with turf by
//   subtracting the water-areas-included polygons from the detailed
//   shoreline-clipped borough boundaries (which only cover land).
// Which borough a point falls in doesn't matter to the app -- only whether
// it's inside the city at all.
//
// The water-areas-included file is an official NYC DCP layer, downloaded
// from the DCP ArcGIS service:
// https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Borough_Boundary_Water_Included/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson
// It is also published on NYC Open Data as "Borough Boundaries (water areas
// included)": https://data.cityofnewyork.us/d/wh2p-dxnf
// The shoreline-clipped layer the slivers were subtracted from was vendored
// from the DCP nybb ArcGIS service (see commit b4e00d42).
import boroughBoundariesWaterAreasFeatureCollection from './borough-boundaries-water-areas-included.geo.json';
import boroughBoundariesShorelineSliversFeatureCollection from './borough-boundaries-shoreline-slivers.geo.json';

export default {
  type: 'FeatureCollection',
  features: [
    ...boroughBoundariesWaterAreasFeatureCollection.features,
    ...boroughBoundariesShorelineSliversFeatureCollection.features,
  ],
};
