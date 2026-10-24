import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ApiClient, CaseItem, EmergencyFeed } from "../data/api";
import { readableDates } from "../domain/format";
import { HAZARD_ICON, HAZARD_LABEL, alertColor, dayDate, dayName, isWarning, km, tempColor } from "./outlookText";

// Leaflet only loads when a case has somewhere to show.
const CaseWeatherMap = lazy(() => import("./CaseWeatherMap").then((m) => ({ default: m.CaseWeatherMap })));
/** Warnings this close to the suburb (to its centre or any point of its area) are shown. */
const NEAR_KM = 150;

/** The customer's week of weather: the Bureau's forecast for their area, its weather signals, and Emergency WA warnings nearby. */
export function CaseWeather({ item, client }: { item: CaseItem; client?: Pick<ApiClient, "emergency"> }) {
  const f = item.forecast ?? null;
  const [feed, setFeed] = useState<EmergencyFeed | null>(null);
  useEffect(() => {
    if (!client?.emergency || !f?.location) return;
    let live = true;
    client.emergency().then((x) => { if (live) setFeed(x); }, () => undefined);
    return () => { live = false; };
  }, [client, f?.location]);
  const near = useMemo(() => {
    if (!feed || !f?.location) return [];
    return feed.alerts.filter((a) => isWarning(a.alertLevel)).map((a) => {
      const pts = [...(a.centre ? [a.centre] : []), ...a.polygons.flat()];
      return { a, km: pts.length ? Math.min(...pts.map((p) => km(f.location!, p))) : Infinity };
    }).filter((x) => x.km <= NEAR_KM).sort((x, y) => x.km - y.km);
  }, [feed, f?.location]);
  const nearAlerts = useMemo(() => near.map((x) => x.a), [near]);

  if (!f) return null;
  const signals = item.weatherSignals ?? [];
  const kinds = [...new Set(f.hazards.map((h) => h.kind))];
  const suburb = item.person?.suburb ?? f.town;

  return (
    <section className="case-card vis-card vis-wide" aria-labelledby="vis-wx">
      <h2 id="vis-wx">Weather and warnings this week</h2>
      <div className="case-wx">
        {f.location ? (
          <Suspense fallback={<div className="case-wx-map" role="status">Loading the map…</div>}>
            <CaseWeatherMap location={f.location} label={`${suburb} (suburb centre)`} alerts={nearAlerts} />
          </Suspense>
        ) : null}
        <div className="case-wx-info">
          <p className="block-label">Bureau forecast for {f.town} <span className="sub">{f.district}</span></p>
          <ol className="case-wx-days">
            {f.days.map((d) => (
              <li key={d.date} title={d.precis}>
                <span className="sub">{dayName(d.date)} {dayDate(d.date)}</span>
                <span className="case-wx-max" style={tempColor(d.max)}>{d.max ?? "–"}°</span>
                <span className="sub">{d.min ?? "–"}°</span>
              </li>
            ))}
          </ol>
          {kinds.length ? <p className="case-wx-kinds">{kinds.map((k) => <span key={k}><span aria-hidden="true">{HAZARD_ICON[k]}</span> {HAZARD_LABEL[k]}</span>)}</p> : <p className="muted">No hot or dangerous weather forecast this week.</p>}

          <p className="block-label">Weather signals</p>
          {signals.length ? (
            <ul className="plain case-wx-list">{signals.map((s) => <li key={s.id}><strong>{s.name}</strong><span className="sub">{readableDates(s.evidence)}</span></li>)}</ul>
          ) : <p className="muted">None: nothing in the forecast reaches the signal limits.</p>}

          <p className="block-label">Emergency WA warnings within {NEAR_KM} km</p>
          {!feed ? <p className="muted">Loading warnings…</p> : !feed.available ? <p className="muted">Emergency WA isn’t available right now.</p> : near.length ? (
            <ul className="plain case-wx-list">
              {near.map(({ a, km: d }) => (
                <li key={a.id}>
                  <span className="case-wx-alert"><i style={{ background: alertColor(a.alertLevel) }} aria-hidden="true" /><strong>{a.headline || a.alertLevel}</strong></span>
                  <span className="sub">{a.alertLevel} · {d < 1 ? "under 1 km away" : `${Math.round(d)} km away`}{a.web ? <> · <a href={a.web} target="_blank" rel="noreferrer">Details</a></> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">None near {suburb}.</p>}
        </div>
      </div>
    </section>
  );
}
