import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { OutlookTown } from "../data/api";
import { hazardColor } from "./outlookText";

/** The forecast towns on a map of WA: coloured by the worst weather coming, sized by the customers to contact. */
export function OutlookMap({ towns, chosen, onChoose }: { towns: OutlookTown[]; chosen: string | null; onChoose: (id: string | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView([-26.5, 121], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const max = Math.max(1, ...towns.map((t) => t.act + t.watch));
    for (const t of towns) {
      const worst = Math.max(0, ...t.hazards.map((h) => h.severity));
      const peak = Math.max(...t.days.map((d) => d.max ?? -99));
      const c = L.circleMarker([t.lat, t.lng], {
        radius: 6 + 20 * Math.sqrt((t.act + t.watch) / max), color: t.id === chosen ? "#253858" : "#fff", weight: t.id === chosen ? 3 : 1.5,
        fillColor: hazardColor(worst), fillOpacity: 0.85,
      }).addTo(g);
      c.bindTooltip(`${t.name}: peak ${peak > -99 ? `${peak}°C` : "n/a"} · ${t.act} act now, ${t.watch} watch`);
      c.on("click", () => choose.current(t.id === chosen ? null : t.id));
    }
  }, [towns, chosen]);

  return (
    <div>
      <div ref={el} className="outlook-map" role="region" aria-label="Map of forecast towns, coloured by the worst weather forecast" />
      <div className="map-zoom outlook-zoom">
        <button type="button" className="link-btn" onClick={() => map.current?.setView([-31.95, 115.86], 9)}>Perth</button>
        <button type="button" className="link-btn" onClick={() => map.current?.setView([-33.2, 116.2], 7)}>South West</button>
        <button type="button" className="link-btn" onClick={() => map.current?.setView([-26.5, 121], 5)}>All of WA</button>
      </div>
    </div>
  );
}
