import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import {
  ASSISTANCE_OPTIONS, DEFAULT_QUERY, PRIORITY_LABELS, applyFilters, facetCounts, overviewCounters, paginate, sortCases,
  type QueueCase, type QueueQuery, type StaffUser,
} from "@greenspark/shared";
import { ApiError } from "./errors";
import { MAX_BULK_ITEMS, WorkflowService, type MutationResult } from "./service";
import type { Store } from "./store";
import type { Clock } from "./clock";
import { SyntheticModelAdapter, withAssessments, type ModelAdapter } from "./adapters";

const STATUSES = ["new", "in_progress", "waiting", "resolved"] as const;
const SORTS = ["priority_desc", "priority_asc", "followup", "name", "updated"] as const;
const VIEWS = ["all", "mine", "unassigned", "needs_review"] as const;

const item = z.object({ caseId: z.string().min(1), expectedVersion: z.number().int().min(1) }).strict();
const items = z.array(item).min(1).max(MAX_BULK_ITEMS).refine((a) => new Set(a.map((i) => i.caseId)).size === a.length, "Duplicate case IDs");
const assignBody = z.object({ assigneeUserId: z.string().min(1).nullable(), items }).strict();
const bulkStatusBody = z.object({ status: z.enum(STATUSES), items }).strict();
const statusBody = z.object({ status: z.enum(STATUSES), expectedVersion: z.number().int().min(1) }).strict();
const noteBody = z.object({ text: z.string().trim().min(1).max(500), expectedVersion: z.number().int().min(1) }).strict();
const reviewBody = z.object({ reviewStatus: z.enum(["needs_review", "reviewed"]), expectedVersion: z.number().int().min(1) }).strict();
const newCaseBody = z.union([
  z.object({ personId: z.string().min(1) }).strict(),
  z.object({ displayName: z.string().trim().min(1).max(100), suburb: z.string().trim().min(1).max(100) }).strict(),
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
  /** Where the teammate-owned full profile lives, e.g. "https://profiles.example/people/{personId}". Null hides the link. */
  profileUrlTemplate?: string | null;
  /** Directory of the built web app. When set, this server also serves the pages (single-process hosting). */
  staticDir?: string | null;
  /** Optional "user:password" for HTTP Basic auth in front of everything except /api/health. For shared demo hosting. */
  basicAuth?: string | null;
}

export function createApp(store: Store, options: AppOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  const model = options.modelAdapter ?? new SyntheticModelAdapter(store);
  const profileUrlTemplate = options.profileUrlTemplate ?? null;
  const service = new WorkflowService(store, clock);
  const enrich = (cases: QueueCase[]) => withAssessments(model, cases);
  const enrichOne = async (c: QueueCase) => (await enrich([c]))[0]!;
  const enrichResult = async (r: MutationResult) => ({ ...r, updated: await enrich(r.updated) });
  const app = express();
  app.disable("x-powered-by");

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

  app.get("/api/catalogs", (_req, res) => {
    const c = store.catalog;
    res.json({
      supportAreas: c.supportAreas, circumstances: c.circumstances, evidenceFields: c.evidenceFields,
      recommendations: c.recommendations, assistanceOptions: ASSISTANCE_OPTIONS, priorityLabels: PRIORITY_LABELS,
      statuses: STATUSES, asOf: c.asOf, profileUrlTemplate,
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
  app.get("/api/cases/ids", async (req, res) => {
    const data = store.dataset();
    data.cases = await enrich(data.cases);
    res.json({ ids: applyFilters(data, queryOf(req), actor(res).id).map((c) => c.id) });
  });

  app.get("/api/cases", async (req, res) => {
    const q = queryOf(req);
    const me = actor(res).id;
    const data = store.dataset();
    data.cases = await enrich(data.cases);
    const matches = sortCases(applyFilters(data, q, me), data.people, q.sort);
    const page = paginate(matches, q.page, q.pageSize);
    const people = new Map(data.people.map((x) => [x.id, x]));
    const f = facetCounts(data, q, me);
    res.json({
      items: page.items.map((c) => ({ case: c, person: people.get(c.personId) ?? null })),
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

  app.get("/api/cases/:caseId/overview", async (req, res) => {
    const c = store.getCase(String(req.params.caseId));
    if (!c) throw new ApiError("not_found", "Case not found.");
    res.json({ case: await enrichOne(c), person: store.getPerson(c.personId) });
  });

  app.post("/api/cases", async (req, res) => {
    const c = service.createCase(parse(newCaseBody, req.body));
    res.status(201).json({ case: await enrichOne(c), person: store.getPerson(c.personId) });
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
    if (bad.type === "entity.parse.failed") {
      res.status(422).json({ error: { code: "validation_failed", message: "The request body is not valid JSON.", details: [] } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong.", details: [] } });
  });

  return app;
}
