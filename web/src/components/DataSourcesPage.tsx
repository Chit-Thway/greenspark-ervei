import { useEffect } from "react";

interface Source { file: string; rows: string; contains: string; extracted: string; leftOut?: string }

/** The synthetic WA utility dataset files, and what scripts/import-utility-dataset.mts takes from each. */
const SOURCES: Source[] = [
  { file: "customers.csv", rows: "5,150", contains: "One row per customer: location, retailer, tariff, meter, payment method, solar, concession, life support, medical cooling subsidy, account dates.",
    extracted: "Suburb and postcode, retailer, plan and tariff, meter type, prepay, payment method, solar size, concession card, life support (and date), medical cooling subsidy, customer since.",
    leftOut: "Closed accounts (only open accounts were chosen); the opening position at 1 Jul 2023 (bills carry it instead)." },
  { file: "contact_preferences.csv", rows: "5,150", contains: "How each customer wants to be contacted.",
    extracted: "Preferred channel, SMS and email opt-in, do not call, consent to proactive support contact, online account, authorised representative, interpreter required." },
  { file: "postcode_context.csv", rows: "58", contains: "Region, retailer and climate details for each postcode.",
    extracted: "Region name, climate zone, north of the 26th parallel (the remote area signal).",
    leftOut: "The disadvantage quintile (marked PLACEHOLDER) and the census, SEIFA, heat and tree canopy columns (empty)." },
  { file: "bills.csv", rows: "56,266", contains: "Every bill: billing period, kWh, charges, credits, amount due, due dates, payment.",
    extracted: "All bills: period, issue and due dates, extensions, kWh (plus the same period last year from daily reads), usage and supply charges, concession, government and feed-in credits, amount due, date paid, paid on time, final and opening-balance bills." },
  { file: "payments.csv", rows: "47,888", contains: "Every payment, with method, kind and result.",
    extracted: "All payments: date, amount, method, kind (bill payment, instalment, HUGS grant, write-off) and whether it cleared or was dishonoured." },
  { file: "customer_month_panel.csv", rows: "110,631", contains: "Each customer's position at every month end, model features, and future-outcome labels.",
    extracted: "Month-end balance, overdue amount, days overdue and concession status (used for arrears growing and concession lapsed).",
    leftOut: "The label_* columns: they record what happened in the next 90 days, for training a model, and must not feed signals or priority. The other features are worked out again from the source records." },
  { file: "consumption_daily.csv.gz", rows: "3,491,513", contains: "Daily meter reads: import by time band, solar export, supply status, outage and self-disconnection hours.",
    extracted: "Monthly totals: kWh, solar export, outage hours, days disconnected; last year's figures for comparison." },
  { file: "consumption_halfhourly_event_windows.csv.gz", rows: "8,176,800", contains: "Half-hourly reads for a few event windows in 2024.",
    extracted: "Nothing.", leftOut: "All of it: the windows only cover parts of 2024, so there is nothing to compare against." },
  { file: "payment_arrangements.csv", rows: "1,767", contains: "Payment plans and bill extensions.",
    extracted: "Payment plans (status, instalments, amount, trigger, dates) and bill extensions (amount, until)." },
  { file: "hardship_programs.csv", rows: "345", contains: "Hardship assessments and programs.",
    extracted: "Every assessment and program: outcome, trigger, instalment, debt at entry, exit and reason, write-off, financial counselling and energy efficiency referrals. Gives the current hardship status." },
  { file: "hugs_grants.csv", rows: "263", contains: "Hardship Utility Grant Scheme applications.", extracted: "Applications: dates, debt, grant amount, approved or declined." },
  { file: "interventions.csv", rows: "3,423", contains: "Help offered or requested, with trial arms and outcomes at 30, 60 and 90 days.",
    extracted: "What was offered, why, by whom, whether it was accepted, and the detail.",
    leftOut: "Trial arms and the balance and outcome measurements after the offer (outcome data for evaluation)." },
  { file: "contacts.csv", rows: "11,110", contains: "Every contact: channel, direction, reason, outcome, sentiment, complaint, agent notes.",
    extracted: "All contacts, shown as Contact history; used for repeat contact, complaints and unanswered outreach." },
  { file: "contact_transcripts.jsonl", rows: "4,406", contains: "Conversation transcripts for some contacts.",
    extracted: "Attached to their contacts. What customers said in the last 12 months raises matching self-report signals (for example \"I lost my job a few weeks ago\" for Lost job)." },
  { file: "collection_events.csv", rows: "44,604", contains: "Collection notices: reminders, warnings, missed instalments, referrals, disconnections.",
    extracted: "All notices (disconnection warnings, plans broken, debt collection referrals and more)." },
  { file: "disconnections.csv", rows: "121", contains: "Disconnections for non-payment and reconnections.", extracted: "All disconnections; supply is \"disconnected\" when the latest has no reconnection." },
  { file: "outage_customer_impacts.csv", rows: "7,439", contains: "Which customers each outage affected, and for how long.", extracted: "Each customer's outages (start, end, hours) for the outage history signal." },
  { file: "outage_events.csv", rows: "355", contains: "Outage events by postcode: planned or not, cause, notice.",
    extracted: "Planned or unplanned, cause and notice date, joined to each customer's outages.", leftOut: "Postcode-level share affected, median duration and the \"anchored to a real event\" flag." },
  { file: "communications_log.csv.gz", rows: "114,720", contains: "Every message sent: type, channel, delivered, opened.",
    extracted: "The last message opened, and messages not delivered in the last 12 months (returned mail, digital disengagement).", leftOut: "Individual delivered messages." },
  { file: "prepay_daily.csv", rows: "109,650", contains: "Daily prepay credit, top-ups and usage cost.", extracted: "The credit on the last day.", leftOut: "The daily history." },
  { file: "prepay_topups.csv", rows: "15,287", contains: "Prepay top-ups with context (payday or after running out).", extracted: "Top-ups in the last 6 months." },
  { file: "prepay_self_disconnections.csv", rows: "8,320", contains: "Each time a prepay meter ran out of credit.", extracted: "Times in the last 12 months: start, hours without power, hot day." },
];

export function DataSourcesPage() {
  useEffect(() => { document.title = "Data sources · ERVEI"; }, []);
  return (
    <main id="queue" className="bts-page" tabIndex={-1}>
      <header className="bts-head">
        <p className="eyebrow">BTS · Data sources</p>
        <h1>Data sources</h1>
        <p className="sub">
          Customer accounts come from a synthetic WA electricity retail dataset: 22 files covering 5,150 customers from 1 Jul 2023 to
          30 Jun 2025. 200 customers were taken, 20 for each testing scenario, by <code>scripts/import-utility-dataset.mts</code>, into
          {" "}<code>data/synthetic/utility-accounts.v1.json</code>.
        </p>
      </header>

      <section className="case-card bts-facts" aria-labelledby="ds-how">
        <h2 id="ds-how">How the data was used</h2>
        <ul className="plain history">
          <li><strong>Dates moved forward 473 days</strong> so the data ends on the app's as-of date, 16 Oct 2026. Seasons move by about 3.5 months.</li>
          <li><strong>Kept fictional:</strong> names, contact details, dates of birth and survey answers. Survey answers about a concession, life support and hardship enrolment are set from the account so they agree.</li>
          <li><strong>From the dataset:</strong> everything on the Utility account, Bills, Support history, Collections and supply, and Contact history sections, plus suburb, postcode and preferred contact channel.</li>
          <li><strong>Never used for signals or priority:</strong> future-outcome labels and intervention outcomes, which exist to train and evaluate models.</li>
        </ul>
      </section>

      <section className="case-card" aria-labelledby="ds-files">
        <h2 id="ds-files">Files <span className="pill">{SOURCES.length}</span></h2>
        <div className="table-scroll">
          <table className="mini-table ds-table">
            <thead><tr><th scope="col">File</th><th scope="col">Rows</th><th scope="col">What's in it</th><th scope="col">What was extracted</th><th scope="col">Left out</th></tr></thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.file}>
                  <th scope="row"><code>{s.file}</code></th>
                  <td className="num">{s.rows}</td>
                  <td>{s.contains}</td>
                  <td>{s.extracted}</td>
                  <td className="muted">{s.leftOut ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
