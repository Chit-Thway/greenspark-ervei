import L from "leaflet";

/**
 * The base map for every map in the app: CARTO's Positron, a pale map with few details, so the weather, warnings
 * and cases stand out even zoomed in. Built from OpenStreetMap data; both are credited.
 */
export function addBaseTiles(map: L.Map): L.TileLayer {
  return L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd", maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
}
