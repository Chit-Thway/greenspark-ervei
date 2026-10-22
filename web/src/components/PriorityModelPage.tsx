import { useEffect } from "react";
import { PRIORITY_PROVIDER, PRIORITY_WEIGHTS, priorityLabel } from "@greenspark/shared";

const w = PRIORITY_WEIGHTS;

const TYPES: [string, string, number][] = [
  ["knockon", "Knock-on effects (act the same day)", w.type.knockon!],
  ["life", "Life circumstances", w.type.life!],
  ["account", "Account circumstances", w.type.account!],
  ["company", "Company-caused circumstances", w.type.company!],
  ["access", "Access needs", w.type.access!],
  ["other", "Any other type", w.otherType],
];

const LABELS: [string, string, string][] = [
  ["urgent", "80 to 100", "Contact the same day."],
  ["high", "60 to 79", "Contact within a few days."],
  ["moderate", "35 to 59", "Contact as part of the normal queue."],
  ["routine", "0 to 34", "No urgency; check on the usual schedule."],
];

const WORSENING: [string, string][] = [
  ["acct_rising_arrears", "Arrears growing"],
  ["acct_usage_drop", "Usage dropped sharply"],
  ["acct_prepay_low_credit", "Prepay credit low"],
  ["acct_disconnection_warning", "Disconnection warning issued"],
];

/** A worked example, scored with the live weights so it stays correct if they change. */
const EXAMPLE = {
  parts: [
    { label: "Disconnection risk (knock-on)", points: w.type.knockon! },
    { label: "Lost job (life, sensitive)", points: w.type.life! + w.sensitive },
    { label: "Missed payments (account)", points: w.type.account! },
  ],
  strong: 3,
  supporting: 2,
};
const exampleTotal = EXAMPLE.parts.reduce((t, p) => t + p.points, 0) + EXAMPLE.strong * w.strongSignal + EXAMPLE.supporting * w.supportingSignal;
const exampleScore = Math.min(100, Math.round(exampleTotal));

export function PriorityModelPage() {
  useEffect(() => { document.title = "Priority model · ERVEI"; }, []);
  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Priority model</p>
        <h1>Priority model</h1>
        <p className="sub">
          Each case's priority is added up from the circumstances the flowchart flags and the signals behind them. There is no
          prediction model: every point can be traced, and the case shows the reasons. It runs in <code>shared/src/priority.ts</code>
          {" "}as <code>{PRIORITY_PROVIDER}</code>.
        </p>
      </header>

      <section className="case-card bts-facts" aria-labelledby="pm-how">
        <h2 id="pm-how">How a score is worked out</h2>
        <ul className="plain history">
          <li><strong>1. Flag circumstances.</strong> The flowchart flags a circumstance on one strong signal or two supporting ones. Sensitive and safety circumstances need a strong signal. Signals come from the account, survey answers, what the customer said in contacts, and the medical cooling subsidy.</li>
          <li><strong>2. Points for each circumstance,</strong> by its type, plus {w.sensitive} if it is sensitive or {w.safety} if it is a safety risk.</li>
          <li><strong>3. Points for each signal,</strong> counted once even if it supports several circumstances, at its strongest link: {w.strongSignal} for strong, {w.supportingSignal} for supporting.</li>
          <li><strong>4. Add up and cap at 100,</strong> then round and label.</li>
        </ul>
      </section>

      <section className="case-card" aria-labelledby="pm-weights">
        <h2 id="pm-weights">Points</h2>
        <div className="table-scroll">
          <table className="mini-table pm-table">
            <thead><tr><th scope="col">For each</th><th scope="col">Points</th></tr></thead>
            <tbody>
              {TYPES.map(([id, label, pts]) => <tr key={id}><th scope="row">{label}</th><td className="num">{pts}</td></tr>)}
              <tr><th scope="row">Extra if sensitive</th><td className="num">+{w.sensitive}</td></tr>
              <tr><th scope="row">Extra if a safety risk</th><td className="num">+{w.safety}</td></tr>
              <tr><th scope="row">Strong signal</th><td className="num">{w.strongSignal}</td></tr>
              <tr><th scope="row">Supporting signal</th><td className="num">{w.supportingSignal}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="pm-labels">
        <h2 id="pm-labels">Labels</h2>
        <div className="table-scroll">
          <table className="mini-table pm-table">
            <thead><tr><th scope="col">Label</th><th scope="col">Score</th><th scope="col">Meaning</th></tr></thead>
            <tbody>
              {LABELS.map(([label, range, meaning]) => (
                <tr key={label}><th scope="row" style={{ textTransform: "capitalize" }}>{label}</th><td>{range}</td><td>{meaning}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card" aria-labelledby="pm-example">
        <h2 id="pm-example">Worked example</h2>
        <div className="table-scroll">
          <table className="mini-table pm-table">
            <tbody>
              {EXAMPLE.parts.map((p) => <tr key={p.label}><th scope="row">{p.label}</th><td className="num">+{p.points}</td></tr>)}
              <tr><th scope="row">{EXAMPLE.strong} strong signals</th><td className="num">+{EXAMPLE.strong * w.strongSignal}</td></tr>
              <tr><th scope="row">{EXAMPLE.supporting} supporting signals</th><td className="num">+{EXAMPLE.supporting * w.supportingSignal}</td></tr>
              <tr><th scope="row">Score</th><td className="num"><strong>{exampleScore} · {priorityLabel(exampleScore)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="case-card bts-facts" aria-labelledby="pm-more">
        <h2 id="pm-more">Trend and edge cases</h2>
        <ul className="plain history">
          <li><strong>Rising trend</strong> when any of these signals is present: {WORSENING.map(([, n]) => n).join(", ")}. Otherwise stable.</li>
          <li><strong>Unavailable</strong> when a case has no account and no survey answers: there is nothing to score, so it shows no score rather than a misleading zero.</li>
          <li><strong>Nothing flagged</strong> scores 0 (routine), like the clean control customers.</li>
          <li><strong>The explanation</strong> on each case names the three circumstances that added the most and the signal counts.</li>
          <li><strong>A model can replace it:</strong> if a model adapter is configured, its assessment is used instead.</li>
        </ul>
      </section>
    </main>
  );
}
