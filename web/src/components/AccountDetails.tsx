import { detectAccountSignals, type Bill, type CustomerAccount, type PaymentKind, type PaymentMethod } from "../domain/types";
import { readableDates, shortDate } from "../domain/format";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  direct_debit: "Direct debit", card: "Card", bpay: "BPAY", centrepay: "Centrepay", cash_counter: "Cash / in person",
  prepay_topup: "Prepay top-up", hugs_grant: "HUGS grant", write_off: "Write-off",
};
const KIND_LABELS: Record<PaymentKind, string> = {
  bill_payment: "Bill payment", hardship_instalment: "Hardship instalment", plan_instalment: "Plan instalment", final_payment: "Final payment",
  hugs_grant: "HUGS grant", reconnection_payment: "Reconnection payment", debt_write_off: "Debt written off",
};
export const date = (iso: string | null | undefined) => (iso ? `${shortDate(iso)} ${iso.slice(0, 4)}` : "Not recorded");
const dateTime = (s: string) => `${date(s)}${s.length > 10 ? `, ${s.slice(11, 16)}` : ""}`;
const dollars = (n: number) => `$${n.toFixed(2)}`;
/** "payment_extension_request" → "Payment extension request" */
const human = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "");
const yesNo = (b: boolean) => (b ? "Yes" : "No");

function billStatus(b: Bill, asOf: string): { text: string; tone: "ok" | "late" | "overdue" } {
  if (b.paidInFullAt) return b.paidInFullAt > b.dueAt ? { text: `Paid late ${date(b.paidInFullAt)}`, tone: "late" } : { text: `Paid ${date(b.paidInFullAt)}`, tone: "ok" };
  const left = b.amount - b.amountPaid;
  if (left <= 0.004) return { text: "Paid", tone: "ok" };
  return b.dueAt < asOf ? { text: `Overdue · ${dollars(left)} owing`, tone: "overdue" } : { text: `Open · ${dollars(left)} owing`, tone: "ok" };
}

/** The account signals a utility account raises, with their evidence. */
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

/** The utility account: retailer, plan, payments setup, concession, protections and contact settings. */
export function UtilityAccount({ account: a, accountNumber }: { account: CustomerAccount; accountNumber: string | null }) {
  const now = a.monthly.at(-1);
  const cp = a.contactPreferences;
  return (
    <section className="case-card" aria-labelledby="ov-account">
      <h3 id="ov-account">Utility account <span className="sim">synthetic dataset</span></h3>
      <dl className="details">
        <div><dt>Account number</dt><dd>{accountNumber ?? "Not recorded"}</dd></div>
        <div><dt>Customer since</dt><dd>{date(a.customerSince)}</dd></div>
        <div><dt>Retailer</dt><dd>{a.retailer}</dd></div>
        <div><dt>Region</dt><dd>{a.region.name}{a.region.northOf26th ? " (north of the 26th parallel)" : ""}</dd></div>
        <div><dt>Plan</dt><dd>{a.plan.name}{a.plan.billingCycle ? ", billed every two months" : ""}</dd></div>
        <div><dt>Meter</dt><dd>{human(a.meterType)}{a.solar ? ` · ${a.solar.kw} kW solar` : ""}</dd></div>
        <div><dt>Supply</dt><dd className={a.supplyStatus === "disconnected" ? "bill-overdue" : undefined}>{a.supplyStatus === "disconnected" ? "Disconnected" : "Connected"}</dd></div>
        <div><dt>Payment method</dt><dd>{METHOD_LABELS[a.paymentMethod]}</dd></div>
        {now ? <div><dt>Balance</dt><dd>{dollars(now.balance)}{now.overdue > 0 ? <span className="bill-overdue"> · {dollars(now.overdue)} overdue ({now.daysOverdueOldest} days)</span> : ""}</dd></div> : null}
        {a.prepay ? <div><dt>Prepay credit</dt><dd>{dollars(a.prepay.creditNow)}</dd></div> : null}
        <div><dt>Concession</dt><dd>{a.concession.status === "active" ? "On the account" : a.concession.status === "lapsed" ? `Lapsed ${date(a.concession.endDate)}` : "None on file"}</dd></div>
        <div><dt>Medical cooling subsidy</dt><dd>{yesNo(a.medicalCoolingSubsidy)}</dd></div>
        <div><dt>Life support</dt><dd>{a.lifeSupport ? `Registered${a.lifeSupportSince ? ` ${date(a.lifeSupportSince)}` : ""}` : "Not registered"}</dd></div>
        <div><dt>Third-party authority</dt><dd>{a.thirdPartyAuthority ? `${a.thirdPartyAuthority.type}${a.thirdPartyAuthority.name ? `: ${a.thirdPartyAuthority.name}` : " (name not recorded)"}` : "None"}</dd></div>
        <div><dt>Hardship program</dt><dd>{a.hardshipProgram.status === "none" ? "Not enrolled" : a.hardshipProgram.status === "active" ? "Enrolled" : `Exited (${human(a.hardshipProgram.exitReason)})`}</dd></div>
        <div><dt>Payment plan</dt><dd>{a.paymentPlan ? `${human(a.paymentPlan.status)}, ${a.paymentPlan.instalments} × ${dollars(a.paymentPlan.instalment)} from ${date(a.paymentPlan.startedAt)}` : "None"}</dd></div>
        <div className="wide">
          <dt>Contact settings</dt>
          <dd>
            Prefers {cp.preferredChannel} · SMS {cp.smsOptIn ? "on" : "off"} · email {cp.emailOptIn ? "on" : "off"}{cp.doNotCall ? " · do not call" : ""} ·
            {" "}proactive support contact: {cp.proactiveSupportConsent === "not_asked" ? "not asked" : cp.proactiveSupportConsent} · online account {cp.onlineAccountActive ? "active" : "not active"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Contacts with the customer, newest first, with the transcript where there is one. */
export function ContactHistory({ account: a }: { account: CustomerAccount }) {
  const contacts = [...a.contacts].reverse();
  return (
    <section className="case-card" aria-labelledby="ov-contacts">
      <h3 id="ov-contacts">Contact history <span className="pill">{contacts.length}</span></h3>
      {contacts.length === 0 ? <p className="muted">No contacts recorded.</p> : (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id}>
              <div className="contact-head">
                <strong>{human(c.reason)}</strong>
                {c.complaint ? <span className="sens sens-safety">Complaint</span> : null}
                {c.repeatWithin7d ? <span className="sens">Repeat</span> : null}
              </div>
              <span className="sub">{date(c.date)} · {human(c.channel)} ({c.direction}) · {human(c.outcome)}{c.sentiment !== null ? ` · sentiment ${c.sentiment.toFixed(2)}` : ""}</span>
              <span className="sub">{c.notes}</span>
              {c.transcript ? (
                <details className="transcript">
                  <summary>Transcript</summary>
                  <ol>{c.transcript.map((t, k) => <li key={k} className={`turn turn-${t.speaker}`}><span className="who">{t.speaker === "agent" ? "Agent" : "Customer"}</span> {t.text}</li>)}</ol>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Hardship programs, payment plans, extensions, HUGS grants and other help offered. */
export function SupportHistory({ account: a }: { account: CustomerAccount }) {
  const empty = !a.hardshipHistory.length && !a.paymentPlans.length && !a.extensions.length && !a.hugsGrants.length && !a.interventions.length;
  return (
    <section className="case-card" aria-labelledby="ov-support-history">
      <h3 id="ov-support-history">Support history</h3>
      {empty ? <p className="muted">No hardship programs, plans, extensions or grants.</p> : null}
      {a.hardshipHistory.length ? (
        <>
          <p className="subhead">Hardship program</p>
          <ul className="plain history">
            {[...a.hardshipHistory].reverse().map((h, k) => (
              <li key={k}>
                <strong>{h.outcome === "accepted" ? "Accepted" : "Declined"}</strong> {date(h.assessedAt)} ({human(h.trigger)})
                <span className="sub">
                  {h.instalment ? `Instalment ${dollars(h.instalment)}. ` : ""}{h.debtAtEntry ? `Debt at entry ${dollars(h.debtAtEntry)}. ` : ""}
                  {h.exitedAt ? `Left ${date(h.exitedAt)}: ${human(h.exitReason)}.` : h.outcome === "accepted" ? "Still enrolled." : ""}
                  {h.writeOff ? ` ${dollars(h.writeOff)} written off.` : ""}{h.financialCounsellingReferral ? " Referred to financial counselling." : ""}{h.energyEfficiencyAdvice ? " Energy efficiency advice given." : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {a.paymentPlans.length ? (
        <>
          <p className="subhead">Payment plans</p>
          <ul className="plain history">
            {[...a.paymentPlans].reverse().map((p, k) => (
              <li key={k}><strong>{human(p.status)}</strong> {date(p.startedAt)}: {p.instalments} × {dollars(p.instalment)} for {dollars(p.amount)} <span className="sub">{human(p.trigger)}{p.endedAt ? `, ended ${date(p.endedAt)}` : ""}</span></li>
            ))}
          </ul>
        </>
      ) : null}
      {a.extensions.length ? (
        <>
          <p className="subhead">Bill extensions</p>
          <ul className="plain history">{[...a.extensions].reverse().map((e, k) => <li key={k}>{date(e.requestedAt)}: {dollars(e.amount)}{e.until ? ` until ${date(e.until)}` : ""}</li>)}</ul>
        </>
      ) : null}
      {a.hugsGrants.length ? (
        <>
          <p className="subhead">HUGS grants</p>
          <ul className="plain history">
            {[...a.hugsGrants].reverse().map((g, k) => <li key={k}><strong>{human(g.outcome)}</strong> {date(g.appliedAt)}: {g.outcome === "approved" ? `${dollars(g.amount)} of ${dollars(g.debt)} debt` : `debt ${dollars(g.debt)}`}{g.paidAt ? `, paid ${date(g.paidAt)}` : ""}</li>)}
          </ul>
        </>
      ) : null}
      {a.interventions.length ? (
        <>
          <p className="subhead">Help offered</p>
          <ul className="plain history">
            {[...a.interventions].reverse().map((x, k) => (
              <li key={k}>{date(x.date)}: {human(x.type)} <span className="sub">{human(x.trigger)}, offered by {x.offeredBy}{x.accepted === null ? "" : x.accepted ? ", accepted" : ", not accepted"}{x.detail ? `, ${human(x.detail)}` : ""}</span></li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Collection notices, disconnections, outages and undelivered messages. */
export function SupplyAndCollections({ account: a }: { account: CustomerAccount }) {
  const notices = [...a.collectionEvents].reverse().slice(0, 12);
  const outages = [...a.outages].reverse();
  return (
    <section className="case-card" aria-labelledby="ov-supply">
      <h3 id="ov-supply">Collections and supply</h3>
      <p className="subhead">Collection notices {a.collectionEvents.length > notices.length ? `(latest ${notices.length} of ${a.collectionEvents.length})` : ""}</p>
      {notices.length ? (
        <table className="mini-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Notice</th><th scope="col">Overdue</th></tr></thead>
          <tbody>{notices.map((e, k) => <tr key={k}><td>{date(e.date)}</td><td className={/disconnect|broken|referred/.test(e.action) ? "bill-overdue" : undefined}>{human(e.action)}</td><td>{e.overdue !== null ? dollars(e.overdue) : ""}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">None.</p>}
      <p className="subhead">Disconnections</p>
      {a.disconnections.length ? (
        <ul className="plain history">{[...a.disconnections].reverse().map((d, k) => <li key={k}>{date(d.date)} with {dollars(d.overdue)} overdue · {d.reconnectedAt ? `reconnected ${date(d.reconnectedAt)}` : <span className="bill-overdue">not reconnected</span>}</li>)}</ul>
      ) : <p className="muted">None.</p>}
      {a.prepay ? (
        <>
          <p className="subhead">Prepay: ran out of credit (last 12 months)</p>
          <p className="sub">{a.prepay.selfDisconnections.length} times, {a.prepay.selfDisconnections.reduce((s, d) => s + d.hours, 0).toFixed(1)} hours without power, {a.prepay.selfDisconnections.filter((d) => d.hotDay).length} on hot days</p>
        </>
      ) : null}
      <p className="subhead">Outages</p>
      {outages.length ? (
        <ul className="plain history">{outages.map((o, k) => <li key={k}>{dateTime(o.start)} · {o.hours.toFixed(1)} hours · {human(o.type)}, {human(o.cause)}{o.noticeDate ? `, notice ${date(o.noticeDate)}` : ""}</li>)}</ul>
      ) : <p className="muted">None.</p>}
      {a.communications.undelivered.length ? (
        <>
          <p className="subhead">Messages not delivered (last 12 months)</p>
          <ul className="plain history">{[...a.communications.undelivered].reverse().map((u, k) => <li key={k}>{date(u.date)} · {human(u.type)} by {u.channel}</li>)}</ul>
        </>
      ) : null}
    </section>
  );
}

/** Bills and payments, or prepaid top-ups. */
export function AccountHistory({ account: a, asOf }: { account: CustomerAccount; asOf: string }) {
  const payments = a.payments.slice(-10).reverse();
  const recharges = (a.prepay?.recharges ?? []).slice(-10).reverse();
  const recentUsage = a.usage.slice(-13, -1).reverse();
  return (
    <section className="case-card" aria-labelledby="ov-bills">
      {a.prepay ? (
        <>
          <h3 id="ov-bills">Prepaid top-ups</h3>
          <table className="mini-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">When</th></tr></thead>
            <tbody>{recharges.map((r, k) => <tr key={k}><td>{dateTime(r.date)}</td><td>{dollars(r.amount)}</td><td>{r.context === "payday" ? "Payday" : "After running out"}</td></tr>)}</tbody>
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
                  const credits = b.charges ? b.charges.concessionCredit + b.charges.govtCredit + b.charges.feedInCredit : 0;
                  return (
                    <tr key={b.id}>
                      <td>{b.openingBalance ? "Opening balance" : `${shortDate(b.periodStart!)} – ${date(b.periodEnd)}`}{b.finalBill ? " (final)" : ""}</td>
                      <td>{date(b.dueAt)}{b.dueDateExtended ? <span className="sub">extended</span> : null}</td>
                      <td>{dollars(b.amount)}{credits > 0 ? <span className="sub">after {dollars(credits)} credits</span> : null}</td>
                      <td>{b.usageKwh !== null ? `${b.usageKwh} kWh` : ""}{b.usageKwhLastYear !== null ? <span className="sub">({b.usageKwhLastYear})</span> : null}</td>
                      <td className={`bill-${st.tone}`}>{st.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="subhead">Usage by month</p>
      <div className="table-scroll">
        <table className="mini-table">
          <thead><tr><th scope="col">Month</th><th scope="col">kWh (last year)</th>{a.solar ? <th scope="col">Solar export</th> : null}<th scope="col">Outage hours</th></tr></thead>
          <tbody>{recentUsage.map((u) => <tr key={u.month}><td>{u.month}</td><td>{u.kWh}{u.kWhLastYear !== null ? <span className="sub">({u.kWhLastYear})</span> : null}</td>{a.solar ? <td>{u.exportKwh} kWh</td> : null}<td>{u.outageHours || ""}</td></tr>)}</tbody>
        </table>
      </div>
      {!a.prepay ? (
        <>
          <p className="subhead">Recent payments</p>
          {payments.length === 0 ? <p className="muted">No payments recorded.</p> : (
            <table className="mini-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Method</th><th scope="col">Type</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {payments.map((p, k) => (
                  <tr key={`${p.date}-${k}`}>
                    <td>{date(p.date)}</td><td>{dollars(p.amount)}</td><td>{METHOD_LABELS[p.method]}</td><td>{KIND_LABELS[p.kind]}</td>
                    <td className={p.status === "dishonoured" ? "bill-overdue" : ""}>{p.status === "dishonoured" ? "Dishonoured" : "Cleared"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </section>
  );
}
