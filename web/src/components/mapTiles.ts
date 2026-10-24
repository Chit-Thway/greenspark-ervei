import L from "leaflet";

/**
 * The base map for every map in the app: OpenStreetMap's standard tiles, faded to pale grey with CSS (.base-tiles),
 * so the weather, warnings and cases stand out even zoomed in. Needs no key. (CARTO's pale tiles need one on a
 * public site.)
 */
export function addBaseTiles(map: L.Map): L.TileLayer {
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, className: "base-tiles",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
}
