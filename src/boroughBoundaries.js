// The borough boundaries GeoJSON used for NYC location validation: DCP's
// "Borough Boundaries (water areas included)" layer, which covers land plus
// the surrounding waterways, so points over water (on bridges, ferries,
// etc.) count as inside NYC. Which borough a point falls in doesn't matter
// to the app -- only whether it's inside the city at all.
//
// Known limitation: the layer is generalized, so a point within ~26m of the
// true coastline at a few spots (Ellis Island's edge is the deepest, at
// ~26m; elsewhere ≤16m and mostly ≤10m) may be reported as outside NYC. If
// that ever matters, subtract this layer from the detailed shoreline-clipped
// borough boundaries (see commit b4e00d42) and include the leftover
// "shoreline slivers".
//
// Downloaded from the DCP ArcGIS service:
// https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Borough_Boundary_Water_Included/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson
// Also published on NYC Open Data as "Borough Boundaries (water areas
// included)": https://data.cityofnewyork.us/d/wh2p-dxnf
import boroughBoundariesWaterAreasFeatureCollection from './borough-boundaries-water-areas-included.geo.json';

export default boroughBoundariesWaterAreasFeatureCollection;
