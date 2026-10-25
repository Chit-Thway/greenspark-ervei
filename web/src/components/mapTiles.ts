import L from "leaflet";

/**
 * The base map for every map in the app: Esri's World Light Gray Base, a plain grey map with no street names or
 * place labels, so the weather, warnings and cases stand out. Needs no key; Esri and its data sources are credited.
 * (CARTO's pale tiles need a key on a public site, and OpenStreetMap's own tiles always have labels.)
 */
export function addBaseTiles(map: L.Map): L.TileLayer {
  return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxNativeZoom: 16, maxZoom: 18,
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community",
  }).addTo(map);
}
