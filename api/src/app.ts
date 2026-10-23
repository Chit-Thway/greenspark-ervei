import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  ASSISTANCE_OPTIONS, DEFAULT_QUERY, PRIORITY_LABELS, applyFilters, facetCounts, overviewCounters, paginate, sortCases,
  type Person, type QueueCase, type QueueQuery, type StaffUser,
} from "@greenspark/shared";
import { ApiError } from "./errors";
import { MAX_BULK_ITEMS, WorkflowService, type MutationResult } from "./service";
import type { Store } from "./store";
import type { Clock } from "./clock";
import { FlowFile } from "./flow";
import type { Predictions } from "./predictions";
import { draftPlan, PLAN_KINDS, perthToday, planFacts, type AiConfig, type ContactRules, type PlanKind, type SupportPlan } from "./plan";
import { FlowError, POSTCODE_LOCATION, detectWeatherSignals, evaluateCase, flowCatalog, parseOp, type FlowDoc, type WeatherSignal, type WeatherSnapshot } from "@greenspark/shared";
import { SyntheticModelAdapter, withAssessments, type ModelAdapter } from "./adapters";

const STATUSES = ["new", "in_progress", "waiting", "resolved"] as const;
const SORTS = ["priority_desc", "priority_asc", "risk_desc", "followup", "name", "updated"] as const;
const VIEWS = ["all", "mine", "needs_review"] as const;

const item = z.object({ caseId: z.string().min(1), expectedVersion: z.number().int().min(1) }).strict();
const items = z.array(item).min(1).max(MAX_BULK_ITEMS).refine((a) => new Set(a.map((i) => i.caseId)).size === a.length, "Duplicate case IDs");
// Every case has a worker, so an assignment always names one.
const assignBody = z.object({ assigneeUserId: z.string().min(1), items }).strict();
const bulkStatusBody = z.object({ status: z.enum(STATUSES), items }).strict();
const statusBody = z.object({ status: z.enum(STATUSES), expectedVersion: z.number().int().min(1) }).strict();
// Notes have no character limit; the 100 KB request-size limit below is the only cap.
const noteBody = z.object({ text: z.string().trim().min(1), expectedVersion: z.number().int().min(1) }).strict();
const reviewBody = z.object({ reviewStatus: z.enum(["needs_review", "reviewed"]), expectedVersion: z.number().int().min(1) }).strict();
// The worker for a new case: required from a manager; a support worker's new case is theirs.
const assignee = { assigneeUserId: z.string().min(1).optional() };
const newCaseBody = z.union([
  z.object({ personId: z.string().min(1), ...assignee }).strict(),
  z.object({ displayName: z.string().trim().min(1).max(100), suburb: z.string().trim().min(1).max(100), ...assignee }).strict(),
]);

const csv = (v: unknown) => (typeof v === "string" && v ? v.split(",") : []);
const listParams = z.object({
  search: z.string().max(100).optional(), view: z.enum(VIEWS).optional(),
  circumstanceIds: z.string().optional(), assistanceIds: z.string().optional(), priorityLabels: z.string().optional(),
  minPriorityScore: z.coerce.number().int().min(0).max(100).optional(),
  assessmentStatus: z.enum(["ready", "pending", "unavailable"]).optional(), status: z.enum(STATUSES).optional(),
  assignedToUserId: z.string().optional(), sort: z.enum(SORTS).optional(),
  page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError("validation_failed", "The request was not valid.", r.error.issues.map((i) => ({ code: i.code, message: `${i.path.join(".") || "body"}: ${i.message}` })));
  }
  return r.data;
}

export interface AppOptions {
  clock?: Clock;
  modelAdapter?: ModelAdapter;
  /** The utility hardship flow JSON file behind the Admin page. */
  flowFile?: string;
  /** Directory of the built web app. When set, this server also serves the pages (single-process hosting). */
  staticDir?: string | null;
  /** Optional "user:password" for HTTP Basic auth in front of everything except /api/health. For shared demo hosting. */
  basicAuth?: string | null;
  /** AI service (Claude or Gemini), key and models for the AI summaries. No key turns them off. */
  ai?: AiConfig | null;
  /** Bureau of Meteorology forecasts and warnings for weather signals. Without it there are none. */
  weather?: { current(): WeatherSnapshot | null; status(): unknown; setMode(mode: "live" | "demo" | "off"): Promise<void> };
  /** The 90-day risk model's scores and model card. Without it there are no predictions. */
  predictions?: Predictions | null;
}

/** A person as the case list needs them: everything but the utility account and its signal summary. */
function listPerson(p: Person | undefined): Person | null {
  if (!p) return null;
  const { account: _account, signalSummary: _summary, ...rest } = p;
  return rest;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  // A model adapter passed in (a real prediction model) always supplies the priority. Otherwise, with the flowchart
  // in use the priority is worked out from each case's signals; without it, the fixture's invented assessments show.
  const model = options.modelAdapter ?? new SyntheticModelAdapter(store);
  const useModel = async () => !!options.modelAdapter || !(await currentFlowDoc());
  const service = new WorkflowService(store, clock);
  const flow = options.flowFile ? new FlowFile(options.flowFile) : null;
  async function currentFlowDoc() { return flow ? flow.current() : null; }
  // Circumstances and solutions come from the Admin flow file when it is configured and valid; otherwise the
  // fixture's fixed survey rules stay in place. Assessments are added after.
  const catalogs = new WeakMap<FlowDoc, ReturnType<typeof flowCatalog>>();
  const catalogOf = (doc: FlowDoc) => { let c = catalogs.get(doc); if (!c) catalogs.set(doc, (c = flowCatalog(doc))); return c; };
  const currentFlow = currentFlowDoc;
  /** The 90-day risk scores for a person, by their dataset customer ID; null without an account or a score. */
  const predictionFor = (person: Person | null) => {
    const p = options.predictions;
    const id = person && p ? store.sourceCustomerId(person.id) : null;
    const score = id ? p!.byCustomer.get(id) ?? null : null;
    if (!score) return null;
    // Each outcome's average rate (on held-out customers), so the page can say how this customer compares.
    const outcomes = Object.fromEntries(Object.entries(score.outcomes).map(([k, o]) => [k, { ...o, baseRate: p!.model.outcomes[k]?.test.baseRate ?? null }]));
    return { ...score, outcomes, modelId: p!.model.id, horizonDays: p!.model.horizonDays };
  };
  /** Just the chance of any harm, for a queue row. */
  const riskFor = (person: Person | null) => {
    const p = predictionFor(person)?.outcomes.any_adverse;
    return p ? { probability: p.probability, baseRate: p.baseRate } : null;
  };
  /** The weather signals for a person's postcode, from the latest forecast, looking ahead from today in Perth. */
  const weatherFor = (person: Person | null): WeatherSignal[] => {
    const w = options.weather?.current() ?? null;
    return person ? detectWeatherSignals(person.address?.postcode, (person.account?.region.northOf26th ?? person.signalSummary?.northOf26th ?? false), w, perthToday(clock())) : [];
  };
  const weatherKey = () => { const w = options.weather?.current(); return w ? `${w.fetchedAt}` : ""; };
  // Each case's result is kept per flowchart version until the case changes (every change bumps its version)
  // or a new forecast arrives (hourly). People never change once written, and a flowchart edit is a new FlowDoc.
  const evaluations = new WeakMap<FlowDoc, Map<string, { version: number; wx: string; result: ReturnType<typeof evaluateCase> }>>();
  const evaluate = (c: QueueCase, doc: FlowDoc) => {
    let byCase = evaluations.get(doc);
    if (!byCase) evaluations.set(doc, (byCase = new Map()));
    const hit = byCase.get(c.id);
    const wx = weatherKey();
    if (hit && hit.version === c.version && hit.wx === wx) return hit.result;
    const person = store.getPerson(c.personId);
    const result = evaluateCase(c, person, store.catalog, doc, catalogOf(doc), weatherFor(person));
    byCase.set(c.id, { version: c.version, wx, result });
    return result;
  };
  const withFlow = async (cases: QueueCase[]) => {
    const doc = await currentFlow();
    if (!doc) return cases;
    return cases.map((c) => ({ ...c, ...evaluate(c, doc) }));
  };
  /** Every case, with the catalogs that match how its circumstances were worked out. */
  const dataset = async () => {
    const data = store.dataset();
    const doc = await currentFlow();
    const out = doc
      ? { ...data, ...catalogOf(doc), circumstanceSource: "flow" as const, cases: data.cases.map((c) => ({ ...c, ...evaluate(c, doc) })) }
      : { ...data, circumstanceSource: "fixture" as const };
    if (await useModel()) out.cases = await withAssessments(model, out.cases);
    return out;
  };
  const enrich = async (cases: QueueCase[]) => {
    const evaluated = await withFlow(cases);
    return (await useModel()) ? withAssessments(model, evaluated) : evaluated;
  };
  const enrichOne = async (c: QueueCase) => (await enrich([c]))[0]!;
  const enrichResult = async (r: MutationResult) => ({ ...r, updated: await enrich(r.updated) });
  const app = express();
  app.disable("x-powered-by");
  // Gzip API responses and the web app's files: case data is large and the demo is served across the world.
  app.use(compression());

  if (options.basicAuth) {
    const expected = Buffer.from(options.basicAuth);
    app.use((req, res, next) => {
      if (req.path === "/api/health") return next();
      const header = req.header("authorization") ?? "";
      const given = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64") : Buffer.alloc(0);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
      res.set("WWW-Authenticate", 'Basic realm="GreenSpark demo"').status(401).send("Authentication required.");
    });
  }
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => { res.json({ ok: true, demo: true }); });

  // Demo identity: the X-Demo-User header must name a fixture user. This is NOT production sign-in.
  const actorOf = (req: Request): StaffUser => {
    const id = req.header("x-demo-user");
    const user = store.catalog.users.find((u) => u.id === id);
    if (!user) throw new ApiError("unauthenticated", "Send a valid X-Demo-User header (demo identity, not real sign-in).");
    return user;
  };
  const auth = (req: Request, res: Response, next: NextFunction) => { res.locals.actor = actorOf(req); next(); };
  app.use("/api", auth);
  const actor = (res: Response) => res.locals.actor as StaffUser;

  app.get("/api/session", (_req, res) => {
    res.json({ user: actor(res), demoIdentity: true, isSynthetic: store.catalog.isSynthetic, asOf: store.catalog.asOf });
  });

  app.get("/api/catalogs", async (_req, res) => {
    const c = store.catalog;
    const doc = await currentFlow();
    const f = doc ? catalogOf(doc) : c;
    res.json({
      supportAreas: f.supportAreas, circumstances: f.circumstances, evidenceFields: c.evidenceFields,
      recommendations: f.recommendations, assistanceOptions: ASSISTANCE_OPTIONS, priorityLabels: PRIORITY_LABELS,
      statuses: STATUSES, asOf: c.asOf, circumstanceSource: doc ? "flow" : "fixture",
    });
  });

  // Everyone can read the shared queue; only managers get the full user list as assignment targets.
  app.get("/api/users", (_req, res) => {
    const a = actor(res);
    res.json({ users: store.catalog.users, assignableUserIds: a.role === "manager" ? store.catalog.users.filter((u) => u.role === "support_worker").map((u) => u.id) : [] });
  });

  const queryOf = (req: Request): QueueQuery => {
    const p = parse(listParams, req.query);
    return {
      ...DEFAULT_QUERY,
      search: p.search ?? "", view: p.view ?? "all",
      circumstanceIds: csv(p.circumstanceIds), assistanceIds: csv(p.assistanceIds),
      priorityLabels: csv(p.priorityLabels).filter((l): l is QueueQuery["priorityLabels"][number] => (PRIORITY_LABELS as string[]).includes(l)),
      minPriorityScore: p.minPriorityScore ?? 0, assessmentStatus: p.assessmentStatus ?? "", status: p.status ?? "",
      assignedToUserId: p.assignedToUserId ?? "", sort: p.sort ?? "priority_desc", page: p.page ?? 1, pageSize: p.pageSize ?? 50,
    };
  };

  // IDs of every case matching the filters (ignores paging); lets the UI drop selections that stopped matching.
  // Admin: the utility hardship flow. Open to every demo user. The JSON file is the only copy of the data.
  app.get("/api/admin/flow", async (_req, res) => {
    if (!flow) throw new ApiError("not_found", "The flow file isn't configured.");
    res.json(await flow.read());
  });

  const flowOpsBody = z.object({ ops: z.array(z.unknown()).min(1).max(200) }).strict();
  app.post("/api/admin/flow/ops", async (req, res) => {
    if (!flow) throw new ApiError("not_found", "The flow file isn't configured.");
    const body = parse(flowOpsBody, req.body);
    let ops;
    try {
      ops = body.ops.map((o) => parseOp(o));
    } catch (e) {
      if (e instanceof FlowError) throw new ApiError("validation_failed", e.message, [{ message: e.message }]);
      throw e;
    }
    res.json(await flow.apply(ops));
  });

  // The map view: every case matching the filters, grouped by postcode, most urgent first in each.
  app.get("/api/cases/map", async (req, res) => {
    const data = await dataset();
    const matches = sortCases(applyFilters(data, queryOf(req), actor(res).id), data.people, "priority_desc");
    const people = new Map(data.people.map((p) => [p.id, p]));
    const places = new Map<string, { postcode: string; suburb: string; lat: number; lng: number; count: number; labels: Record<string, number>; cases: { accountNumber: string | null; displayName: string; score: number | null; label: string | null; status: string }[] }>();
    let unplaced = 0;
    for (const c of matches) {
      const p = people.get(c.personId);
      const postcode = p?.address?.postcode ?? "";
      const at = POSTCODE_LOCATION[postcode];
      if (!p || !at) { unplaced++; continue; }
      let place = places.get(postcode);
      if (!place) places.set(postcode, (place = { postcode, suburb: p.suburb, lat: at[0], lng: at[1], count: 0, labels: {}, cases: [] }));
      place.count++;
      const label = c.modelAssessment.priority?.label ?? "none";
      place.labels[label] = (place.labels[label] ?? 0) + 1;
      // Enough to list in the panel; the rest are counted.
      if (place.cases.length < 50) place.cases.push({ accountNumber: p.accountNumber ?? null, displayName: p.displayName, score: c.modelAssessment.priority?.score ?? null, label: c.modelAssessment.priority?.label ?? null, status: c.workflow.status });
    }
    res.json({ total: matches.length, unplaced, places: [...places.values()] });
  });

  app.get("/api/cases/ids", async (req, res) => {
    const data = await dataset();
    res.json({ ids: applyFilters(data, queryOf(req), actor(res).id).map((c) => c.id) });
  });

  app.get("/api/cases", async (req, res) => {
    const q = queryOf(req);
    const me = actor(res).id;
    const data = await dataset();
    const byPerson = new Map(data.people.map((p) => [p.id, p]));
    const matches = sortCases(applyFilters(data, q, me), data.people, q.sort, (c) => riskFor(byPerson.get(c.personId) ?? null)?.probability ?? null);
    const page = paginate(matches, q.page, q.pageSize);
    const people = new Map(data.people.map((x) => [x.id, x]));
    const f = facetCounts(data, q, me);
    res.json({
      // The list leaves out each person's utility account (the case page fetches it), which keeps pages small.
      items: page.items.map((c) => ({ case: c, person: listPerson(people.get(c.personId)), risk: riskFor(people.get(c.personId) ?? null) })),
      total: page.total, page: page.page, pageSize: q.pageSize, pageCount: page.pageCount, from: page.from, to: page.to,
      counters: overviewCounters(data.cases, me),
      facets: {
        view: f.view,
        circumstances: Object.fromEntries(data.circumstances.map((c) => [c.id, f.circumstance(c.id)])),
        areas: Object.fromEntries(data.supportAreas.map((a) => [a.id, f.area(a.circumstanceIds)])),
        assistance: Object.fromEntries(ASSISTANCE_OPTIONS.map((o) => [o.id, f.assistance(o.id)])),
        priority: Object.fromEntries(PRIORITY_LABELS.map((l) => [l, f.priority(l)])),
      },
    });
  });

  // The account number is the customer's main ID; each account has one case.
  app.get("/api/accounts/:accountNumber", async (req, res) => {
    const found = store.getPersonByAccount(String(req.params.accountNumber));
    const person = found && store.getPersonWithAccount(found.id);
    const c = person && store.getCaseForPerson(person.id);
    if (!person || !c) throw new ApiError("not_found", "No case was found for that account number.");
    res.json({ case: await enrichOne(c), person, weatherSignals: weatherFor(person), prediction: predictionFor(person) });
  });

  app.get("/api/cases/:caseId/overview", async (req, res) => {
    const c = store.getCase(String(req.params.caseId));
    if (!c) throw new ApiError("not_found", "Case not found.");
    const person = store.getPersonWithAccount(c.personId);
    res.json({ case: await enrichOne(c), person, weatherSignals: weatherFor(person), prediction: predictionFor(person) });
  });

  // The risk model: what it predicts, how it was trained and how well it did on held-out customers.
  app.get("/api/model/risk", (_req, res) => {
    const m = options.predictions?.model;
    if (!m) throw new ApiError("not_found", "No risk model is loaded on this server.");
    res.json({ model: m, scoredCustomers: options.predictions!.byCustomer.size });
  });

  app.get("/api/weather", (_req, res) => { res.json(options.weather?.status() ?? { mode: "off", available: false }); });
  // Managers switch the weather source for everyone: the sample heatwave, the Bureau's live data, or off.
  app.post("/api/weather/mode", async (req, res) => {
    if (actor(res).role !== "manager") throw new ApiError("forbidden", "Only managers can change the weather source.");
    if (!options.weather) throw new ApiError("not_found", "Weather signals aren't set up on this server.");
    const { mode } = parse(z.object({ mode: z.enum(["live", "demo", "off"]) }), req.body);
    await options.weather.setMode(mode);
    res.json(options.weather.status());
  });

  // Plans are kept per case version and flowchart version, so each case calls the AI once until it changes.
  const plans = new WeakMap<object, Map<string, Promise<SupportPlan>>>();
  const noFlow = {};
  app.get("/api/cases/:caseId/plan", async (req, res) => {
    const raw = store.getCase(String(req.params.caseId));
    if (!raw) throw new ApiError("not_found", "Case not found.");
    const doc = await currentFlow();
    const byDoc = plans.get(doc ?? noFlow) ?? new Map<string, Promise<SupportPlan>>();
    plans.set(doc ?? noFlow, byDoc);
    const kind = (PLAN_KINDS.includes(req.query.kind as PlanKind) ? req.query.kind : "support") as PlanKind;
    // Weather signals change with the forecast, so they are part of the key: a new heat forecast drafts a new plan.
    const wxSignals = weatherFor(store.getPerson(raw.personId));
    const key = `${kind}:${raw.id}@${raw.version}:${wxSignals.map((s) => s.evidence).join("|")}`;
    let plan = byDoc.get(key);
    if (!plan) {
      const c = await enrichOne(raw);
      const cat = doc ? catalogOf(doc) : store.catalog;
      const person = store.getPersonWithAccount(c.personId);
      const facts = planFacts(kind, c, person, cat, store.catalog.asOf, wxSignals);
      const acct = person?.account;
      const contact: ContactRules | undefined = acct ? {
        preferred: acct.contactPreferences.preferredChannel, sms: acct.contactPreferences.smsOptIn, email: acct.contactPreferences.emailOptIn,
        doNotCall: acct.contactPreferences.doNotCall, interpreter: acct.interpreterRequired,
      } : undefined;
      if (!facts) throw new ApiError("not_found", "Nothing to summarise for this case.");
      plan = draftPlan(kind, facts, options.ai ?? null, c.recommendations.map((r) => r.recommendationId), contact, perthToday(clock()));
      byDoc.set(key, plan);
      plan.catch(() => byDoc.delete(key)); // failures are retried on the next load
    }
    res.json({ plan: await plan });
  });

  app.post("/api/cases", async (req, res) => {
    const c = service.createCase(actor(res), parse(newCaseBody, req.body));
    res.status(201).json({ case: await enrichOne(c), person: store.getPersonWithAccount(c.personId) });
  });

  app.post("/api/cases/bulk/assignment", async (req, res) => {
    const b = parse(assignBody, req.body);
    res.json(await enrichResult(service.assign(actor(res), b.assigneeUserId, b.items)));
  });

  app.post("/api/cases/bulk/status", async (req, res) => {
    const b = parse(bulkStatusBody, req.body);
    res.json(await enrichResult(service.setStatus(actor(res), b.status, b.items, true)));
  });

  app.patch("/api/cases/:caseId/status", async (req, res) => {
    const b = parse(statusBody, req.body);
    res.json(await enrichResult(service.setStatus(actor(res), b.status, [{ caseId: String(req.params.caseId), expectedVersion: b.expectedVersion }], false)));
  });

  app.post("/api/cases/:caseId/notes", async (req, res) => {
    const b = parse(noteBody, req.body);
    res.status(201).json({ case: await enrichOne(service.addNote(actor(res), String(req.params.caseId), b.text, b.expectedVersion)) });
  });

  app.patch("/api/cases/:caseId/notes/:noteId", async (req, res) => {
    const b = parse(noteBody, req.body);
    res.json({ case: await enrichOne(service.editNote(actor(res), String(req.params.caseId), String(req.params.noteId), b.text, b.expectedVersion)) });
  });

  app.patch("/api/cases/:caseId/review", async (req, res) => {
    const b = parse(reviewBody, req.body);
    res.json(await enrichResult(service.setReview(actor(res), String(req.params.caseId), b.reviewStatus, b.expectedVersion)));
  });

  app.post("/api/workflow-actions/:actionId/undo", async (req, res) => {
    res.json(await enrichResult(service.undo(actor(res), String(req.params.actionId))));
  });

  app.use("/api", (_req, _res, next) => next(new ApiError("not_found", "No such endpoint.")));

  if (options.staticDir) {
    const dir = options.staticDir;
    app.use(express.static(dir));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.sendFile(join(dir, "index.html")); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, ...(err.extra ? { current: (err.extra as { current: unknown }).current } : {}) } });
      return;
    }
    const bad = err as { type?: string; status?: number };
    if (bad.type === "entity.too.large") {
      res.status(422).json({ error: { code: "validation_failed", message: "That is too much text for one request (the limit is about 100 KB, roughly 100,000 characters).", details: [] } });
      return;
    }
    if (bad.type === "entity.parse.failed") {
      res.status(422).json({ error: { code: "validation_failed", message: "The request body is not valid JSON.", details: [] } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong.", details: [] } });
  });

  return app;
}
