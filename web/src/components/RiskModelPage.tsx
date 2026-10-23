import { useEffect, useState } from "react";
import type { ApiClient, RiskModelCard } from "../data/api";
import { OUTCOME_LABEL, OUTCOME_ORDER, percent } from "./predictionText";

/** BTS page: what the 90-day risk model predicts, how it was trained and how well it did. */
export function RiskModelPage({ client }: { client: ApiClient }) {
  const [card, setCard] = useState<RiskModelCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = "Risk model · ERVEI"; }, []);
  useEffect(() => { client.riskModel?.().then(setCard, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load the model.")); }, [client]);
  const m = card?.model;

  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Risk model</p>
        <h1>Risk model</h1>
        <p className="sub">
          Predicts how likely each customer is to come to harm in the next 90 days, from their account's latest month. It is trained offline by
          {" "}<code>scripts/train-risk-model.mts</code>; the app only reads its scores.
        </p>
      </header>
      {error ? <p className="muted" role="alert">{error}</p> : !m ? <p className="muted">Loading…</p> : (
        <>
          <section className="case-card bts-facts" aria-labelledby="rm-how">
            <h2 id="rm-how">How it works</h2>
            <ul className="plain history">
              <li><strong>Trained on</strong> {m.trainingMonths.toLocaleString()} customer-months from <code>customer_month_panel.csv</code> whose 90 days had fully passed, so the outcome is known. Each row has what the account looked like at a month end, and whether each harm happened in the 90 days after.</li>
              <li><strong>Tested on</strong> {m.testMonths.toLocaleString()} months from customers it never saw: {m.heldOut}.</li>
              <li><strong>Model:</strong> {m.type}. Each input has a weight, so every score can be explained by what pushed it up.</li>
              <li><strong>Scores</strong> each open customer's latest month ({card!.scoredCustomers.toLocaleString()} customers), whose 90 days haven't happened yet. That is the prediction, shown on each case and on the customer's predictions page.</li>
              <li><strong>Bands</strong> compare a customer's chance with the average for that harm: Very high is 10 times the average or more, High 4 times, Raised 1.5 times, and Low anything less. "Riskier than X% of customers" ranks them against every scored customer.</li>
              <li><strong>Never an input:</strong> survey answers, names and contact details. The outcomes (label columns) are only used to learn from, never to score.</li>
            </ul>
          </section>

          <section className="case-card" aria-labelledby="rm-acc">
            <h2 id="rm-acc">How well it did on held-out customers</h2>
            <div className="table-scroll">
              <table className="mini-table pm-table">
                <thead><tr><th scope="col">Outcome in 90 days</th><th scope="col">How common</th><th scope="col">Ranking (AUC)</th><th scope="col">Riskiest 5% catch</th><th scope="col">Of those, it happened to</th></tr></thead>
                <tbody>
                  {OUTCOME_ORDER.map((id) => {
                    const o = m.outcomes[id];
                    if (!o) return null;
                    return (
                      <tr key={id}>
                        <th scope="row">{OUTCOME_LABEL[id]}</th>
                        <td>{percent(o.test.baseRate)} of months</td>
                        <td>{o.test.auc.toFixed(2)}</td>
                        <td>{Math.round(o.test.top5.recall * 100)}% of cases</td>
                        <td>{Math.round(o.test.top5.precision * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">AUC is the chance the model ranks a customer who came to harm above one who didn't: 0.5 is guessing, 1 is perfect. Because the harms are rare, even the riskiest 5% are mostly fine.</p>
          </section>

          <section className="case-card" aria-labelledby="rm-cal">
            <h2 id="rm-cal">Are the percentages right?</h2>
            <p className="hint">Held-out months in ten equal groups, riskiest first: the average predicted chance of any harm against how often it happened.</p>
            <div className="table-scroll">
              <table className="mini-table pm-table">
                <thead><tr><th scope="col">Group</th><th scope="col">Predicted</th><th scope="col">Happened</th></tr></thead>
                <tbody>
                  {m.outcomes.any_adverse!.test.calibration.map((g, i) => (
                    <tr key={i}><th scope="row">{i === 0 ? "Riskiest 10%" : i === 9 ? "Safest 10%" : `${i + 1}`}</th><td>{percent(g.predicted)}</td><td>{percent(g.actual)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="case-card" aria-labelledby="rm-w">
            <h2 id="rm-w">What matters most for "any of these harms"</h2>
            <p className="hint">The inputs with the biggest weights. Positive raises the risk; negative lowers it (for example, being in the hardship program).</p>
            <div className="table-scroll">
              <table className="mini-table pm-table">
                <thead><tr><th scope="col">Input</th><th scope="col">Weight</th></tr></thead>
                <tbody>
                  {Object.entries(m.outcomes.any_adverse!.weights).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 12).map(([id, w]) => (
                    <tr key={id}><th scope="row">{m.inputs.find((x) => x.id === id)?.label ?? id}</th><td>{w > 0 ? "+" : ""}{w.toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="case-card bts-facts" aria-labelledby="rm-limits">
            <h2 id="rm-limits">Limits</h2>
            <ul className="plain history">
              <li><strong>Synthetic data.</strong> {m.caveat} Accuracy this high would be unusual with real customers.</li>
              <li><strong>Fairness.</strong> Concession, life support and region are inputs because they relate to the outcomes. Scores must only ever lead to offering help sooner, never to stricter treatment.</li>
              <li><strong>A snapshot.</strong> Scores come from the data's latest month and don't change as workers act. Retrain to refresh them: <code>npx tsx scripts/train-risk-model.mts &lt;source folder&gt;</code>.</li>
              <li><strong>Not every customer.</strong> 150 prepay customers are missing from the monthly records, so they have no score.</li>
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
