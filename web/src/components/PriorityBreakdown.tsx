import { CIRCUMSTANCE_TYPE_NAMES, PRIORITY_WEIGHTS, priorityBreakdown, priorityLabel } from "@greenspark/shared";
import type { QueueCase } from "../domain/types";
import type { Catalog } from "../data/api";

const pts = (n: number) => `+${Number.isInteger(n) ? n : n.toFixed(1)}`;
const THRESHOLDS: [number, string][] = [[35, "Moderate"], [60, "High"], [80, "Urgent"]];

/** How a case's priority adds up: each flagged circumstance and each signal behind them, with its points. */
export function PriorityBreakdownView({ c, data }: { c: QueueCase; data: Catalog }) {
  const b = priorityBreakdown(c.circumstances, new Map(data.circumstances.map((d) => [d.id, d])));
  if (!b.circumstances.length) return null;
  const circTotal = b.circumstances.reduce((t, r) => t + r.points, 0);
  const sigTotal = b.signals.reduce((t, r) => t + r.points, 0);
  const strong = b.signals.filter((s) => s.strength === "strong");
  const supporting = b.signals.filter((s) => s.strength === "supporting");
  const label = priorityLabel(b.score);
  const w = PRIORITY_WEIGHTS;

  return (
    <div className="pb">
      <div className="pb-meter" aria-label={`Score ${b.score} out of 100`}>
        <div className="pb-track">
          <span className="pb-part pb-circ" style={{ width: `${Math.min(100, circTotal)}%` }} title={`Circumstances ${pts(circTotal)}`} />
          <span className="pb-part pb-sig" style={{ width: `${Math.max(0, Math.min(100 - circTotal, sigTotal))}%` }} title={`Signals ${pts(sigTotal)}`} />
          {THRESHOLDS.map(([at, name]) => <i key={at} className="pb-tick" style={{ left: `${at}%` }} title={`${name} from ${at}`} />)}
        </div>
        <div className="pb-scale" aria-hidden="true">{THRESHOLDS.map(([at, name]) => <span key={at} style={{ left: `${at}%` }}>{name} {at}</span>)}</div>
        <p className="pb-sum">
          <span className="pb-key pb-circ" /> Circumstances <strong>{pts(circTotal)}</strong>
          <span className="pb-key pb-sig" /> Signals <strong>{pts(sigTotal)}</strong>
          = <strong>{Math.round(b.total * 10) / 10}</strong>{b.capped ? <> → capped at <strong>100</strong></> : null}
          <span className={`badge badge-${label}`}>{label[0]!.toUpperCase() + label.slice(1)} · {b.score}</span>
        </p>
      </div>

      <p className="block-label">Circumstances flagged <span className="pill">{b.circumstances.length}</span></p>
      <table className="mini-table pb-table">
        <thead><tr><th scope="col">Circumstance</th><th scope="col">Type</th><th scope="col" className="num">Type points</th><th scope="col" className="num">Extra</th><th scope="col" className="num">Points</th></tr></thead>
        <tbody>
          {[...b.circumstances].sort((x, y) => y.points - x.points).map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.label}</th>
              <td className="muted">{CIRCUMSTANCE_TYPE_NAMES[r.type] ?? "Other"}</td>
              <td className="num">{pts(r.base)}</td>
              <td className="num">{r.extraFor ? <span className={`sens sens-${r.extraFor}`}>{r.extraFor === "safety" ? "Safety" : "Sensitive"} {pts(r.extra)}</span> : <span className="muted">–</span>}</td>
              <td className="num"><strong>{pts(r.points)}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row" colSpan={4}>Circumstances</th><td className="num"><strong>{pts(circTotal)}</strong></td></tr></tfoot>
      </table>

      <p className="block-label">Signals behind them <span className="pill">{b.signals.length}</span> <span className="sub">each counted once, at its strongest link</span></p>
      <table className="mini-table pb-table">
        <thead><tr><th scope="col">Signal</th><th scope="col">Strength</th><th scope="col" className="num">Points</th></tr></thead>
        <tbody>
          {[...strong, ...supporting].map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.name}{s.worsening ? <span className="pb-rising" title="Means things are getting worse: makes the trend rising"> ↑ worsening</span> : null}</th>
              <td><span className={`strength strength-${s.strength}`}>{s.strength === "strong" ? "Strong" : "Supporting"}</span></td>
              <td className="num">{pts(s.points)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><th scope="row" colSpan={2}>{strong.length} strong × {w.strongSignal} + {supporting.length} supporting × {w.supportingSignal}</th><td className="num"><strong>{pts(sigTotal)}</strong></td></tr></tfoot>
      </table>

      <p className="hint">
        Points by type: knock-on effect {w.type.knockon}, life situation {w.type.life}, bill or account issue {w.type.account}, company practice {w.type.company},
        access barrier {w.type.access}; sensitive +{w.sensitive}, safety +{w.safety}. Signals: strong +{w.strongSignal}, supporting +{w.supportingSignal}.
        {b.signals.some((s) => s.worsening) ? " The trend is rising because a worsening signal is present." : " The trend is steady: no worsening signal."}
      </p>
    </div>
  );
}
