import { useEffect, useMemo, useRef, useState } from "react";
import { loadDataset } from "./data/caseSource";
import type { QueueCase, QueueDataset, QueueQuery } from "./domain/types";
import { ASSISTANCE_OPTIONS, DEFAULT_QUERY, activeFilterCount, applyFilters, overviewCounters, paginate, personOf, sortCases } from "./domain/query";
import { PRIORITY_TEXT, STATUS_LABELS } from "./domain/format";
import { FilterSidebar } from "./components/FilterSidebar";
import { CaseTable } from "./components/CaseTable";
import { OverviewPanel } from "./components/OverviewPanel";
import { NewCasePanel, type NewCaseInput } from "./components/NewCasePanel";

export function App() {
  const [data, setData] = useState<QueueDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadDataset().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : "Could not load cases."));
  }, []);
  if (error) return <div className="state-screen" role="alert"><h1>We couldn’t load the case queue</h1><p>{error}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div>;
  if (!data) return <div className="state-screen" role="status"><p>Loading cases…</p></div>;
  return <Workspace initial={data} />;
}

function Workspace({ initial }: { initial: QueueDataset }) {
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState<QueueQuery>(DEFAULT_QUERY);
  const [currentUserId, setCurrentUserId] = useState("staff-manager");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const user = data.users.find((u) => u.id === currentUserId)!;
  const matches = useMemo(() => applyFilters(data, query, currentUserId), [data, query, currentUserId]);
  const sorted = useMemo(() => sortCases(matches, data.people, query.sort), [matches, data.people, query.sort]);
  const page = paginate(sorted, query.page, query.pageSize);
  const counters = overviewCounters(data.cases, currentUserId);
  const openCase = data.cases.find((c) => c.id === openCaseId) ?? null;

  // Filter changes drop selected ids that no longer match; page resets to 1.
  const change = (patch: Partial<QueueQuery>) => {
    const next = { ...query, ...patch, page: "page" in patch ? patch.page! : 1 };
    setQuery(next);
    const still = new Set(applyFilters(data, next, currentUserId).map((c) => c.id));
    setSelected((s) => new Set([...s].filter((id) => still.has(id))));
  };
  const switchUser = (id: string) => {
    setCurrentUserId(id);
    if (query.view === "mine") setQuery({ ...query, page: 1 });
    setSelected(new Set());
  };
  const open = (id: string) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setNewCaseOpen(false);
    setOpenCaseId(id);
  };
  const close = () => {
    setOpenCaseId(null);
    setNewCaseOpen(false);
    returnFocus.current?.focus();
  };
  const say = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };

  const createCase = (input: NewCaseInput) => {
    const n = data.cases.length;
    const personId = `demo-person-${String(n + 1).padStart(3, "0")}`;
    const now = `${data.asOf}T09:00:00+08:00`;
    const person = { id: personId, displayName: input.displayName, suburb: input.suburb, state: "WA", householdSummary: "Not recorded", contactPreference: null, fullProfilePath: null };
    const c: QueueCase = {
      id: `GS-${2001 + n}`, personId, version: 1, reportedAt: null, reportedAnswers: {}, answerAvailability: {},
      supportAreaIds: [], circumstances: [],
      assistance: { hardshipEnrolmentAtReport: null, energyBillConcessionAtReport: null, reportedHistory: [] },
      recommendations: [],
      modelAssessment: { provider: "synthetic_demo", isSimulated: true, status: "pending", priority: null, trend: null, explanation: null },
      workflow: { status: "new", assignedToUserId: null, createdAt: now, updatedAt: now, followUpAt: null, reviewStatus: "needs_review", notes: [] },
    };
    setData({ ...data, people: [...data.people, person], cases: [...data.cases, c] });
    setNewCaseOpen(false);
    setOpenCaseId(c.id);
    say(`Added ${input.displayName} as ${c.id}. This demo change lasts until you reload.`);
  };

  const rowsOnPage = page.items;
  const filterCount = activeFilterCount(query);
  const panelOpen = openCase !== null || newCaseOpen;

  return (
    <div className={`app${panelOpen ? " has-panel" : ""}`}>
      <a className="skip" href="#queue">Skip to case queue</a>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">🌱</span>
          <span><strong>GreenSpark</strong><span className="brand-sub">ERVEI · CASEWORK</span></span>
        </div>
        <span className="tagline">Community support workspace</span>
        <span className="demo-pill">Synthetic demo data</span>
        <label className="whoami">
          <span className="whoami-label">Demo view</span>
          <select value={currentUserId} onChange={(e) => switchUser(e.target.value)} aria-label="Demo user (not real sign-in)">
            {data.users.map((u) => <option key={u.id} value={u.id}>{u.displayName} · {u.role === "manager" ? "Manager" : "Support worker"}</option>)}
          </select>
        </label>
      </header>

      <div className="shell">
        <button type="button" className="btn filters-toggle" aria-expanded={filtersOpen} aria-controls="sidebar" onClick={() => setFiltersOpen((v) => !v)}>
          Filters{filterCount ? ` (${filterCount})` : ""}
        </button>
        <aside id="sidebar" className={`sidebar${filtersOpen ? " is-open" : ""}`} aria-label="Filters">
          <FilterSidebar data={data} query={query} currentUserId={currentUserId} onChange={change} onReset={() => { setQuery({ ...DEFAULT_QUERY }); setSelected(new Set()); }} />
        </aside>

        <main id="queue" className="main" tabIndex={-1}>
          <div className="page-head">
            <div>
              <p className="eyebrow">People first. Support that reaches.</p>
              <h1>Case queue</h1>
              <p className="sub">A clearer view of who needs support next.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => { returnFocus.current = document.activeElement as HTMLElement; setOpenCaseId(null); setNewCaseOpen(true); }}>
              + New case
            </button>
          </div>

          <section className="counters" aria-label="Active case shortcuts (all cases, not filtered)">
            <div className="counter"><strong>{counters.urgent}</strong><span>Urgent cases</span></div>
            <div className="counter"><strong>{counters.awaitingAssignment}</strong><span>Awaiting assignment</span></div>
            <div className="counter"><strong>{counters.myActive}</strong><span>My active cases</span></div>
          </section>
          <p className="hint counters-note">Counters cover all unresolved cases and ignore the filters.</p>

          <section className="panel" aria-labelledby="list-title">
            <div className="panel-head">
              <h2 id="list-title">{({ all: "All cases", mine: "Assigned to me", unassigned: "Unassigned", needs_review: "Needs review" })[query.view]} <span className="pill">{page.total}</span></h2>
              <span className="sim">Model suggestions · simulated data</span>
            </div>

            <div className="toolbar">
              <label className="search">
                <span className="sr-only">Search by name, case ID or suburb</span>
                <input type="search" placeholder="Search name, case ID or suburb…" value={query.search} onChange={(e) => change({ search: e.target.value })} />
              </label>
              <label className="sort">
                <span className="sr-only">Sort cases</span>
                <select value={query.sort} onChange={(e) => change({ sort: e.target.value as QueueQuery["sort"] })}>
                  <option value="priority_desc">Priority: highest first</option>
                  <option value="priority_asc">Priority: lowest first</option>
                  <option value="followup">Follow-up: soonest</option>
                  <option value="updated">Recently updated</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>

            <div className="chips" aria-label="Active filters">
              {query.circumstanceIds.map((id) => <Chip key={id} label={data.circumstances.find((c) => c.id === id)?.label ?? id} onRemove={() => change({ circumstanceIds: query.circumstanceIds.filter((x) => x !== id) })} />)}
              {query.assistanceIds.map((id) => <Chip key={id} label={ASSISTANCE_OPTIONS.find((o) => o.id === id)?.label ?? id} onRemove={() => change({ assistanceIds: query.assistanceIds.filter((x) => x !== id) })} />)}
              {query.priorityLabels.map((l) => <Chip key={l} label={`Priority: ${PRIORITY_TEXT[l]}`} onRemove={() => change({ priorityLabels: query.priorityLabels.filter((x) => x !== l) })} />)}
              {query.minPriorityScore > 0 ? <Chip label={`Score ≥ ${query.minPriorityScore}`} onRemove={() => change({ minPriorityScore: 0 })} /> : null}
              {query.assessmentStatus ? <Chip label={`Assessment: ${query.assessmentStatus}`} onRemove={() => change({ assessmentStatus: "" })} /> : null}
              {query.status ? <Chip label={`Status: ${STATUS_LABELS[query.status]}`} onRemove={() => change({ status: "" })} /> : null}
              {query.assignedToUserId ? <Chip label={`Worker: ${query.assignedToUserId === "__none__" ? "Unassigned" : data.users.find((u) => u.id === query.assignedToUserId)?.displayName}`} onRemove={() => change({ assignedToUserId: "" })} /> : null}
            </div>

            {selected.size > 0 ? (
              <div className="bulkbar" role="region" aria-label="Selected cases">
                <strong>{selected.size} selected</strong>
                <button type="button" className="btn btn-small" disabled={user.role !== "manager"} title="Connected when the API is added">Assign…</button>
                <button type="button" className="btn btn-small" disabled title="Connected when the API is added">Update status…</button>
                <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            ) : null}

            {page.total === 0 ? (
              <div className="empty"><h3>No cases match</h3><p>Try removing a filter or changing the search.</p><button type="button" className="btn" onClick={() => { setQuery({ ...DEFAULT_QUERY }); }}>Reset filters</button></div>
            ) : (
              <CaseTable
                data={data} rows={rowsOnPage} currentUserId={currentUserId} selectedIds={selected} openCaseId={openCaseId}
                onToggleRow={(id, on) => setSelected((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; })}
                onTogglePage={(on) => setSelected((s) => { const n = new Set(s); rowsOnPage.forEach((r) => (on ? n.add(r.id) : n.delete(r.id))); return n; })}
                onOpen={open}
              />
            )}

            <div className="pager">
              <span aria-live="polite">Showing {page.from}–{page.to} of {page.total} cases</span>
              <nav aria-label="Pagination">
                <button type="button" className="btn btn-small" disabled={page.page <= 1} onClick={() => change({ page: page.page - 1 })}>Previous</button>
                <span className="page-no">Page {page.page} of {page.pageCount}</span>
                <button type="button" className="btn btn-small" disabled={page.page >= page.pageCount} onClick={() => change({ page: page.page + 1 })}>Next</button>
              </nav>
            </div>
          </section>

          <footer className="foot"><span>All people and case details are fictional.</span><span>Demo date {data.asOf}</span></footer>
        </main>

        {openCase ? <OverviewPanel key={openCase.id} data={data} c={openCase} person={personOf(data.people, openCase)} currentUserId={currentUserId} onClose={close} /> : null}
        {newCaseOpen ? <NewCasePanel onSubmit={createCase} onClose={close} /> : null}
      </div>

      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="chip">{label}<button type="button" aria-label={`Remove filter ${label}`} onClick={onRemove}>✕</button></span>
  );
}
