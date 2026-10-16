import { useEffect, useRef } from "react";
import type { Person, QueueCase, QueueDataset } from "../domain/types";
import { describeFollowUp, formatDateTime, initials, PERIOD_TEXT, STATUS_LABELS } from "../domain/format";
import { isResolved } from "../domain/query";
import { profileUrl } from "../config";
import { PriorityBadge } from "./Primitives";

function answerText(c: QueueCase, fieldId: string): { text: string; tone: "yes" | "no" | "unknown" } {
  const v = c.reportedAnswers[fieldId];
  if (v === null || v === undefined) {
    const av = c.answerAvailability[fieldId];
    return { text: av === "not_asked" ? "Not asked" : "Unknown / not recorded", tone: "unknown" };
  }
  return { text: v, tone: v === "No" ? "no" : "yes" };
}

export function OverviewPanel(props: { data: QueueDataset; c: QueueCase; person: Person | undefined; currentUserId: string; onClose: () => void }) {
  const { data, c, person } = props;
  const ref = useRef<HTMLElement>(null);
  const field = (id: string) => data.evidenceFields.find((f) => f.id === id);
  const assignee = data.users.find((u) => u.id === c.workflow.assignedToUserId);
  const userName = (id: string) => data.users.find((u) => u.id === id)?.displayName ?? id;
  const fu = describeFollowUp(c.workflow.followUpAt, isResolved(c), data.asOf);
  const link = person ? profileUrl(person.id) : null;
  const a = c.modelAssessment;

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const history = c.assistance.reportedHistory;
  return (
    <aside className="overview" role="dialog" aria-modal="false" aria-labelledby="ov-title" tabIndex={-1} ref={ref}>
      <header className="ov-head">
        <span className="eyebrow">Case details · {c.id}</span>
        <button type="button" className="icon-btn" aria-label="Close overview" onClick={props.onClose}>✕</button>
      </header>

      <div className="ov-person">
        <span className="avatar avatar-lg" aria-hidden="true">{initials(person?.displayName ?? "?")}</span>
        <div>
          <h2 id="ov-title">{person?.displayName ?? "Unknown person"}</h2>
          <p className="sub">{person?.suburb}, {person?.state} · {c.personId}</p>
        </div>
      </div>

      <div className="ov-row">
        <PriorityBadge c={c} />
        <span className={`sub follow-${fu.tone}`}>{fu.text}</span>
      </div>

      <dl className="facts">
        <div><dt>Assigned worker</dt><dd>{assignee ? assignee.displayName : "Unassigned"}</dd></div>
        <div><dt>Household</dt><dd>{person?.householdSummary}</dd></div>
        <div><dt>Case status</dt><dd>{STATUS_LABELS[c.workflow.status]}</dd></div>
        <div>
          <dt>Contact preference (demo)</dt>
          <dd>{person?.contactPreference ? `${person.contactPreference.channel}, ${person.contactPreference.preferredWindow}` : "Not recorded"}</dd>
        </div>
      </dl>
      {link ? <a className="link-btn" href={link} target="_blank" rel="noreferrer">Open full profile</a> : (
        <p className="hint">Full profile link appears when the profile route is configured.</p>
      )}

      <section className="ov-section model" aria-labelledby="ov-model">
        <h3 id="ov-model">Model assessment <span className="sim">simulated · {a.provider}</span></h3>
        {a.status === "ready" && a.priority ? (
          <>
            <p>Priority {a.priority.score}/100 ({a.priority.label}) · trend: {a.trend ?? "unknown"}</p>
            <p className="hint">{a.explanation}</p>
          </>
        ) : (
          <p>{a.status === "pending" ? "Assessment pending. No priority has been assigned." : "Assessment unavailable. No priority has been assigned."}</p>
        )}
      </section>

      <section className="ov-section" aria-labelledby="ov-support">
        <h3 id="ov-support">Support areas and why</h3>
        {c.circumstances.length === 0 ? <p className="muted">No circumstances flagged from the reported answers.</p> : null}
        {data.supportAreas.filter((area) => c.supportAreaIds.includes(area.id)).map((area) => (
          <div key={area.id} className="area-block">
            <h4>{area.label}</h4>
            {c.circumstances.filter((x) => data.circumstances.find((d) => d.id === x.circumstanceId)?.supportAreaId === area.id).map((x) => {
              const def = data.circumstances.find((d) => d.id === x.circumstanceId)!;
              const recs = c.recommendations.filter((r) => r.circumstanceIds.includes(x.circumstanceId));
              return (
                <div key={x.circumstanceId} className="circ">
                  <strong>{def.label}</strong>
                  <ul className="evidence">
                    {x.evidenceFieldIds.map((fid) => {
                      const f = field(fid);
                      const ans = answerText(c, fid);
                      return (
                        <li key={fid}>
                          <span>{f?.label ?? fid} <span className="sub">({fid}, {f ? PERIOD_TEXT[f.referencePeriod] : ""}{c.reportedAt ? `, reported ${c.reportedAt}` : ""})</span></span>
                          <span className={`answer answer-${ans.tone}`}>{ans.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {recs.length ? (
                    <p className="suggest">
                      <span className="sim">Suggested for staff review</span>{" "}
                      {recs.map((r) => data.recommendations.find((d) => d.id === r.recommendationId)?.label).join(" · ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="ov-section" aria-labelledby="ov-assist">
        <h3 id="ov-assist">Assistance already reported</h3>
        <p className="hint">Separate from support needs. Past support is not a current plan.</p>
        <ul className="evidence">
          <li><span>Hardship program enrolment (at report)</span><span className={`answer answer-${answerText(c, "Q37").tone}`}>{answerText(c, "Q37").text}</span></li>
          <li><span>Energy-bill concession (at report)</span><span className={`answer answer-${answerText(c, "Z7_8").tone}`}>{answerText(c, "Z7_8").text}</span></li>
        </ul>
        <p className="subhead">Reported in the past 12 months</p>
        {history.length ? (
          <ul className="plain">{history.map((h) => <li key={h.evidenceFieldId}>{field(h.evidenceFieldId)?.label ?? h.evidenceFieldId}</li>)}</ul>
        ) : (
          <p className="muted">{c.answerAvailability.Q36b_1 === "unknown" ? "Unknown. Not recorded." : "None reported."}</p>
        )}
      </section>

      <section className="ov-section" aria-labelledby="ov-review">
        <h3 id="ov-review">Worker review</h3>
        <p>{c.workflow.reviewStatus === "reviewed" ? "Suggestions reviewed by staff." : "Suggestions awaiting worker review."}</p>
        <div className="actions">
          <button type="button" className="btn" disabled title="Connected when the API is added">Mark reviewed</button>
          <button type="button" className="btn" disabled title="Connected when the API is added">Assign worker</button>
        </div>
      </section>

      <section className="ov-section" aria-labelledby="ov-progress">
        <h3 id="ov-progress">Case progress</h3>
        <label className="field">
          <span>Case status</span>
          <select value={c.workflow.status} disabled>
            {Object.entries(STATUS_LABELS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </label>
        <p className="hint">Status, assignment and notes become editable once the workflow API is connected.</p>
      </section>

      <section className="ov-section" aria-labelledby="ov-notes">
        <h3 id="ov-notes">Case notes</h3>
        {c.workflow.notes.length === 0 ? <p className="muted">No notes added yet.</p> : (
          <ul className="notes">
            {c.workflow.notes.map((n) => (
              <li key={n.id}><p>{n.text}</p><span className="sub">{userName(n.authorUserId)} · {formatDateTime(n.createdAt)}</span></li>
            ))}
          </ul>
        )}
        <label className="field">
          <span>Add a case note</span>
          <textarea rows={3} disabled placeholder="Record a check-in, referral or next step…" />
        </label>
      </section>
    </aside>
  );
}
