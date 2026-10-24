import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { EmergencyAlert } from "../data/api";
import { alertPopup, triangle } from "./OutlookMap";
import { alertColor } from "./outlookText";

/** The customer's suburb and the Emergency WA warnings near it. Fits the suburb and the warnings, or zooms in on the suburb. */
export function CaseWeatherMap({ location, label, alerts }: { location: [number, number]; label: string; alerts: EmergencyAlert[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    const points: [number, number][] = [location];
    for (const a of alerts) {
      const color = alertColor(a.alertLevel);
      for (const p of a.polygons) { L.polygon(p, { color, weight: 2, fillColor: color, fillOpacity: 0.25 }).bindPopup(() => alertPopup(a)).addTo(m); points.push(...p); }
      if (a.centre) { L.marker(a.centre, { icon: triangle(color), title: a.headline || a.alertLevel }).bindPopup(() => alertPopup(a)).addTo(m); points.push(a.centre); }
    }
    // The suburb's centre, not the customer's address: the dataset has no coordinates.
    L.circleMarker(location, { radius: 9, color: "#fff", weight: 2, fillColor: "#00875a", fillOpacity: 1 }).bindTooltip(label).addTo(m);
    if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 10 });
    else m.setView(location, 10);
    return () => { m.remove(); };
  }, [location, label, alerts]);
  return <div ref={el} className="case-wx-map" role="region" aria-label={`Map of ${label} and nearby Emergency WA warnings`} />;
}
