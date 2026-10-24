import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addBaseTiles } from "./mapTiles";
import type { MapPlace, MapSummary } from "../data/api";
import { accountHref, isModifiedClick } from "../route";

const LABELS = ["urgent", "high", "moderate", "routine"] as const;
const LABEL_TEXT: Record<string, string> = { urgent: "Urgent", high: "High", moderate: "Moderate", routine: "Routine", none: "No priority" };
// Same colours as the priority badges.
const COLOR: Record<string, string> = { urgent: "#c0392b", high: "#d9822b", moderate: "#b8a200", routine: "#2e8b57", none: "#7a869a" };
const worst = (p: MapPlace) => LABELS.find((l) => p.labels[l]) ?? "none";
const STATUS: Record<string, string> = { new: "New", in_progress: "In progress", waiting: "Waiting", resolved: "Resolved" };

/** The matching cases on a map of WA, one circle per suburb, sized by count and coloured by the most urgent case. */
export function CaseMap({ summary, onOpen }: { summary: MapSummary; onOpen: (accountNumber: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const place = summary.places.find((p) => p.postcode === chosen) ?? null;

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: true }).setView([-31.95, 115.86], 9);
    addBaseTiles(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const max = Math.max(1, ...summary.places.map((p) => p.count));
    for (const p of summary.places) {
      const c = L.circleMarker([p.lat, p.lng], {
        radius: 6 + 18 * Math.sqrt(p.count / max), color: "#fff", weight: 1.5, fillColor: COLOR[worst(p)], fillOpacity: 0.85,
      }).addTo(g);
      c.bindTooltip(`${p.suburb} ${p.postcode}: ${p.count} case${p.count === 1 ? "" : "s"}`);
      c.on("click", () => setChosen(p.postcode));
    }
    if (chosen && !summary.places.some((p) => p.postcode === chosen)) setChosen(null);
  }, [summary, chosen]);

  const fitAll = () => {
    if (!map.current || !summary.places.length) return;
    map.current.fitBounds(L.latLngBounds(summary.places.map((p) => [p.lat, p.lng] as [number, number])), { padding: [24, 24] });
  };

  return (
    <div className="case-map">
      <div className="map-bar">
        <span className="hint">
          {summary.total} case{summary.total === 1 ? "" : "s"} in {summary.places.length} suburb{summary.places.length === 1 ? "" : "s"}
          {summary.unplaced ? ` · ${summary.unplaced} without a known postcode, not shown` : ""}
        </span>
        <span className="map-legend" aria-label="Colour shows the most urgent case">
          {[...LABELS, "none" as const].map((l) => <span key={l}><i style={{ background: COLOR[l] }} />{LABEL_TEXT[l]}</span>)}
        </span>
        <span className="map-zoom">
          <button type="button" className="link-btn" onClick={() => map.current?.setView([-31.95, 115.86], 9)}>Perth</button>
          <button type="button" className="link-btn" onClick={fitAll}>All of WA</button>
        </span>
      </div>
      <div className="map-body">
        <div ref={el} className="map-canvas" role="region" aria-label="Map of matching cases by suburb" />
        <aside className="map-panel" aria-live="polite">
          {place ? (
            <>
              <h3>{place.suburb} <span className="sub">{place.postcode}</span></h3>
              <p className="hint">
                {place.count} case{place.count === 1 ? "" : "s"}: {[...LABELS, "none"].filter((l) => place.labels[l]).map((l) => `${place.labels[l]} ${LABEL_TEXT[l]!.toLowerCase()}`).join(", ")}
              </p>
              <ul className="map-cases">
                {place.cases.map((c) => (
                  <li key={c.accountNumber ?? c.displayName}>
                    {c.accountNumber ? (
                      <a href={accountHref(c.accountNumber)} onClick={(e) => { if (isModifiedClick(e)) return; e.preventDefault(); onOpen(c.accountNumber!); }}>{c.displayName}</a>
                    ) : <span>{c.displayName}</span>}
                    <span className={`badge badge-${c.label ?? "none"}`}>{c.label ? `${LABEL_TEXT[c.label]} · ${c.score}` : "No priority"}</span>
                    <span className="sub">{c.accountNumber} · {STATUS[c.status] ?? c.status}</span>
                  </li>
                ))}
              </ul>
              {place.count > place.cases.length ? <p className="hint">Showing the {place.cases.length} most urgent. Search for {place.suburb} in the list to see them all.</p> : null}
            </>
          ) : <p className="hint">Click a circle to see that suburb's cases, most urgent first.</p>}
        </aside>
      </div>
    </div>
  );
}
