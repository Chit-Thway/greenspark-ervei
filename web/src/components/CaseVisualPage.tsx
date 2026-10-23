import { useEffect, useState } from "react";
import { detectAccountSignals } from "../domain/types";
import type { ApiClient, CaseItem, Catalog, SupportPlan } from "../data/api";
import { accountHref, isModifiedClick } from "../route";
import { UsageChart } from "./AccountDetails";
import { OUTCOME_LABEL, OUTCOME_ORDER, band, percent } from "./predictionText";

const money = (n: number) => `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
const PRIORITY_COLOR: Record<string, string> = { urgent: "var(--urgent)", high: "var(--high)", moderate: "var(--moderate)", routine: "var(--routine)" };

/** A half-circle gauge for a score out of 100. */
function Gauge({ score, color, label }: { score: number; color: string; label: string }) {
  const r = 60, len = Math.PI * r;
  return (
    <svg viewBox="0 0 140 84" className="vis-gauge" role="img" aria-label={`${label}: ${score} out of 100`}>
      <path d="M10 76 A60 60 0 0 1 130 76" fill="none" stroke="var(--border)" strokeWidth="12" strokeLinecap="round" />
      <path d="M10 76 A60 60 0 0 1 130 76" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(len * score) / 100} ${len}`} />
      <text x="70" y="70" textAnchor="middle" className="vis-gauge-n">{score}</text>
    </svg>
  );
}

/** One case at a glance: how urgent, what's going on, what to offer, in pictures and few words. */
export function CaseVisualPage({ client, data, accountNumber, navigate }: { client: ApiClient; data: Catalog; accountNumber: string; navigate: (to: string) => void }) {
  const [item, setItem] = useState<CaseItem | null>(null);
  const [plan, setPlan] = useState<SupportPlan | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setItem(null); setPlan(null); setPlanFailed(false); setError(null);
    client.account(accountNumber).then((i) => {
      if (!live) return;
      setItem(i);
      if (i.case.circumstances.length) client.supportPlan?.(i.case.id, "support").then((p) => live && setPlan(p), () => live && setPlanFailed(true));
    }, (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load this case."));
    return () => { live = false; };
  }, [client, accountNumber]);
  const name = item?.person?.displayName ?? accountNumber;
  useEffect(() => { document.title = `At a glance · ${name} · ERVEI`; }, [name]);
  const go = (to: string) => (e: React.MouseEvent) => { if (isModifiedClick(e)) return; e.preventDefault(); navigate(to); };

  if (error) return <main id="queue" className="bts-page" tabIndex={-1}><div className="empty" role="alert"><h1>We couldn’t load this case</h1><p>{error}</p></div></main>;
  if (!item) return <main id="queue" className="bts-page" tabIndex={-1}><div className="empty" role="status"><p>Loading…</p></div></main>;

  const c = item.case, person = item.person, a = person?.account ?? null;
  const priority = c.modelAssessment.priority;
  const overdue = a?.monthly.at(-1)?.overdue ?? 0;
  const signals = [...(a ? detectAccountSignals(a, data.asOf) : []), ...(item.weatherSignals ?? [])];
  const caseHref = accountHref(accountNumber);
  const circ = (id: string) => data.circumstances.find((x) => x.id === id);
  const areas = data.supportAreas
    .map((area) => ({ area, items: c.circumstances.filter((x) => circ(x.circumstanceId)?.supportAreaId === area.id) }))
    .filter((g) => g.items.length);
  const order = plan?.order?.length ? plan.order : c.recommendations.map((r) => ({ id: r.recommendationId, reason: "", due: undefined, method: undefined }));
  const top = order.slice(0, 3).map((o) => ({ ...o, label: data.recommendations.find((r) => r.id === o.id)?.label ?? o.id }));
  const facts: { icon: string; label: string; tone: "bad" | "warn" | "ok" | "info" }[] = a ? [
    { icon: a.supplyStatus === "disconnected" ? "⏻" : "⚡", label: a.supplyStatus === "disconnected" ? "Disconnected" : "Power on", tone: a.supplyStatus === "disconnected" ? "bad" : "ok" },
    { icon: "$", label: overdue > 0 ? `${money(overdue)} overdue` : "Nothing overdue", tone: overdue > 0 ? "warn" : "ok" },
    ...(a.lifeSupport ? [{ icon: "♥", label: "Life support", tone: "bad" as const }] : []),
    ...(a.medicalCoolingSubsidy ? [{ icon: "❄", label: "Medical cooling", tone: "warn" as const }] : []),
    { icon: "▣", label: a.concession.status === "active" ? "Concession on file" : "No concession", tone: a.concession.status === "active" ? "info" : "warn" },
    { icon: "◷", label: a.hardshipProgram.status === "active" ? "In hardship program" : "Not in hardship program", tone: a.hardshipProgram.status === "active" ? "info" : "warn" },
    ...(a.plan.type === "prepaid" ? [{ icon: "▤", label: "Prepay meter", tone: "info" as const }] : []),
    ...(a.interpreterRequired ? [{ icon: "✆", label: "Interpreter needed", tone: "info" as const }] : []),
  ] : [];

  return (
    <main id="queue" className="bts-page vis-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">At a glance · {accountNumber}</p>
        <h1>{name}</h1>
        <p className="sub">{person?.suburb}{person?.suburb ? ", " : ""}{person?.state} · <a href={caseHref} onClick={go(caseHref)}>Open the full case</a></p>
      </header>

      <div className="vis-grid">
        <section className="case-card vis-card" aria-labelledby="vis-pri">
          <h2 id="vis-pri">How urgent</h2>
          {priority ? (
            <>
              <Gauge score={priority.score} color={PRIORITY_COLOR[priority.label] ?? "var(--muted)"} label="Priority" />
              <p className="vis-big" style={{ color: PRIORITY_COLOR[priority.label] }}>{priority.label[0]!.toUpperCase() + priority.label.slice(1)}</p>
              <p className="hint">{c.modelAssessment.trend === "rising" ? "↑ Getting worse" : "→ Steady"}</p>
            </>
          ) : <p className="muted">No priority yet.</p>}
        </section>

        <section className="case-card vis-card" aria-labelledby="vis-risk">
          <h2 id="vis-risk">Chance of harm, next 90 days</h2>
          {item.prediction ? (
            <ul className="vis-bars">
              {OUTCOME_ORDER.map((id) => {
                const o = item.prediction!.outcomes[id];
                if (!o) return null;
                const b = band(o.probability, o.baseRate);
                return (
                  <li key={id} className={`pred-${b.id}`}>
                    <span>{OUTCOME_LABEL[id]}</span>
                    <span className="vis-bar"><i style={{ width: `${Math.max(2, Math.min(100, o.probability * 100 * (100 / 80)))}%` }} /></span>
                    <strong>{percent(o.probability)}</strong>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">No prediction for this customer.</p>}
        </section>

        <section className="case-card vis-card vis-wide" aria-labelledby="vis-facts">
          <h2 id="vis-facts">The account</h2>
          {facts.length ? (
            <ul className="vis-facts">{facts.map((f) => <li key={f.label} className={`vis-${f.tone}`}><span className="vis-icon" aria-hidden="true">{f.icon}</span>{f.label}</li>)}</ul>
          ) : <p className="muted">No utility account.</p>}
        </section>

        <section className="case-card vis-card vis-wide" aria-labelledby="vis-going">
          <h2 id="vis-going">What's going on</h2>
          {areas.length ? (
            <div className="vis-areas">
              {areas.map(({ area, items }) => (
                <div key={area.id} className="vis-area">
                  <p className="block-label">{area.label}</p>
                  <ul className="vis-chips">{items.map((x) => { const d = circ(x.circumstanceId); return <li key={x.circumstanceId} className={d?.sensitivity === "safety" ? "vis-safety" : d?.sensitivity === "sensitive" ? "vis-sensitive" : undefined}>{d?.label ?? x.circumstanceId}</li>; })}</ul>
                </div>
              ))}
            </div>
          ) : <p className="muted">Nothing flagged.</p>}
          <p className="hint">{signals.length} warning sign{signals.length === 1 ? "" : "s"} in the account{signals.length ? `: ${signals.slice(0, 4).map((s) => s.name).join(", ")}${signals.length > 4 ? "…" : ""}` : ""}.</p>
        </section>

        <section className="case-card vis-card vis-wide" aria-labelledby="vis-do">
          <h2 id="vis-do">What to do first</h2>
          {plan?.text ? <p className="vis-plan">{plan.text}</p> : planFailed ? <p className="muted">The AI plan isn't available right now; these are the standard first solutions.</p> : c.circumstances.length ? <p className="muted">Drafting a support plan…</p> : null}
          {top.length ? (
            <ol className="vis-steps">
              {top.map((s, i) => (
                <li key={s.id}>
                  <span className="rank-num">{i + 1}</span>
                  <div><strong>{s.label}</strong>{s.due ? <span className="sub"> · by {new Date(`${s.due}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}{s.method ? ` · ${({ phone: "phone call", sms: "SMS", email: "email", letter: "letter" } as Record<string, string>)[s.method]}` : ""}</span> : null}</div>
                </li>
              ))}
            </ol>
          ) : <p className="muted">No solutions suggested.</p>}
          {plan ? <p className="hint">AI draft · check before acting.</p> : null}
        </section>

        {a?.usage.length ? (
          <section className="case-card vis-card vis-wide" aria-labelledby="vis-use">
            <h2 id="vis-use">Electricity use</h2>
            <UsageChart usage={a.usage.slice(-12)} />
          </section>
        ) : null}
      </div>
    </main>
  );
}
