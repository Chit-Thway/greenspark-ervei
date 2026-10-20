import { detectAccountSignals, type Bill, type CustomerAccount, type PaymentMethod } from "../domain/types";
import { readableDates, shortDate } from "../domain/format";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  direct_debit: "Direct debit", card: "Card", bpay: "BPAY", centrepay: "Centrepay", cash_counter: "Cash / in person",
};
export const date = (iso: string | null | undefined) => (iso ? `${shortDate(iso)} ${iso.slice(0, 4)}` : "Not recorded");
const dollars = (n: number) => `$${n.toFixed(2)}`;

function billStatus(b: Bill, asOf: string): { text: string; tone: "ok" | "late" | "overdue" } {
  if (b.paidInFullAt) return b.paidInFullAt > b.dueAt ? { text: `Paid late ${date(b.paidInFullAt)}`, tone: "late" } : { text: `Paid ${date(b.paidInFullAt)}`, tone: "ok" };
  const left = dollars(b.amount - b.amountPaid);
  return b.dueAt < asOf ? { text: `Overdue · ${left} owing`, tone: "overdue" } : { text: `Open · ${left} owing`, tone: "ok" };
}

/** The account signals a fictional utility account raises, with their evidence. */
export function AccountSignals({ account, asOf }: { account: CustomerAccount; asOf: string }) {
  const signals = detectAccountSignals(account, asOf);
  return (
    <section className="case-card" aria-labelledby="ov-signals">
      <h3 id="ov-signals">Account signals <span className="sim">from account data</span></h3>
      <p className="hint">Each signal prompts an offer of help, never a penalty. Check it makes sense before acting.</p>
      {signals.length === 0 ? <p className="muted">No account signals.</p> : (
        <ul className="signal-list">
          {signals.map((s) => <li key={s.id}><strong>{s.name}</strong><span className="sub">{readableDates(s.evidence)}</span></li>)}
        </ul>
      )}
    </section>
  );
}

/** The fictional utility account behind a case: plan, payments setup, concession and protections. */
export function UtilityAccount({ account: a, accountNumber }: { account: CustomerAccount; accountNumber: string | null }) {
  return (
    <section className="case-card" aria-labelledby="ov-account">
      <h3 id="ov-account">Utility account <span className="sim">fictional</span></h3>
      <dl className="details">
        <div><dt>Account number</dt><dd>{accountNumber ?? "Not recorded"}</dd></div>
        <div><dt>Customer since</dt><dd>{date(a.customerSince)}</dd></div>
        <div><dt>Plan</dt><dd>{a.plan.type === "prepaid" ? "Prepaid" : "Postpaid, billed every two months"}{a.supplyType === "embedded" ? " · embedded network" : ""}</dd></div>
        <div><dt>Payment method</dt><dd>{METHOD_LABELS[a.paymentMethod]}</dd></div>
        <div>
          <dt>Concession</dt>
          <dd>{a.concession.status === "none" ? "None on file" : `${a.concession.type} (${a.concession.status === "active" ? "valid to" : "lapsed"} ${date(a.concession.endDate)})`}</dd>
        </div>
        <div className="wide">
          <dt>Third-party authority</dt>
          <dd>{a.thirdPartyAuthority ? `${a.thirdPartyAuthority.type}: ${a.thirdPartyAuthority.name}, since ${date(a.thirdPartyAuthority.since)}` : "None"}</dd>
        </div>
        <div><dt>Hardship program</dt><dd>{a.hardshipProgram.status === "none" ? "Not enrolled" : a.hardshipProgram.status === "active" ? "Enrolled" : `Exited (${a.hardshipProgram.exitReason?.replace(/_/g, " ")})`}</dd></div>
        <div><dt>Payment plan</dt><dd>{a.paymentPlan ? `${a.paymentPlan.status[0].toUpperCase()}${a.paymentPlan.status.slice(1)}, ${dollars(a.paymentPlan.instalment)} ${a.paymentPlan.frequency}` : "None"}</dd></div>
        <div><dt>Life support</dt><dd>{a.lifeSupport ? "Registered" : "Not registered"}</dd></div>
      </dl>
    </section>
  );
}

/** Bills and payments, or prepaid top-ups. */
export function AccountHistory({ account: a, asOf }: { account: CustomerAccount; asOf: string }) {
  const payments = a.payments.slice(-8).reverse();
  const recharges = (a.prepay?.recharges ?? []).slice(-8).reverse();
  return (
    <section className="case-card" aria-labelledby="ov-bills">
      {a.prepay ? (
        <>
          <h3 id="ov-bills">Prepaid top-ups</h3>
          <p className="hint">Ran out of credit on {a.prepay.zeroCreditEvents.map(date).join(", ")}.</p>
          <table className="mini-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Method</th></tr></thead>
            <tbody>{recharges.map((r) => <tr key={r.date}><td>{date(r.date)}</td><td>{dollars(r.amount)}</td><td>{METHOD_LABELS[r.method]}</td></tr>)}</tbody>
          </table>
        </>
      ) : (
        <>
          <h3 id="ov-bills">Bills</h3>
          <div className="table-scroll">
            <table className="mini-table">
              <thead><tr><th scope="col">Period</th><th scope="col">Due</th><th scope="col">Amount</th><th scope="col">Usage (last year)</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {[...a.bills].reverse().map((b) => {
                  const st = billStatus(b, asOf);
                    return (
                    <tr key={b.id}>
                      <td>{shortDate(b.periodStart)} – {date(b.periodEnd)}</td>
                      <td>{date(b.dueAt)}</td>
                      <td>{dollars(b.amount)}</td>
                      <td>{b.usageKwh} kWh{b.estimatedRead ? " (estimate)" : ""} <span className="sub">({b.usageKwhLastYear})</span></td>
                      <td className={`bill-${st.tone}`}>{st.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="subhead">{a.prepay ? "Usage" : "Recent payments"}</p>
      {a.prepay ? (
        <p className="sub">Last two months: {a.usage.slice(-2).reduce((s, u) => s + u.kWh, 0)} kWh (same months last year {a.usage.slice(-2).reduce((s, u) => s + u.kWhLastYear, 0)} kWh)</p>
      ) : payments.length === 0 ? <p className="muted">No payments in the last 12 months.</p> : (
        <table className="mini-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Result</th></tr></thead>
          <tbody>
            {payments.map((p, k) => (
              <tr key={`${p.date}-${k}`}>
                <td>{date(p.date)}</td><td>{dollars(p.amount)}</td><td>{METHOD_LABELS[p.method]}</td>
                <td className={p.status === "dishonoured" ? "bill-overdue" : ""}>{p.status === "dishonoured" ? "Dishonoured" : "Cleared"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
