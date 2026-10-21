// One-paragraph AI summaries drafted by Google Gemini for three parts of a case:
//   support:   the plan from the flagged circumstances (Support areas and why);
//   signals:   what the account signals say together (Account signals);
//   solutions: which solutions to offer first and how (Solutions to offer).
// Only circumstances, signals, solutions and contact settings are sent: never names or contact details.
import { detectAccountSignals, type CircumstanceDefinition, type Person, type QueueCase, type RecommendationDefinition } from "@greenspark/shared";
import { ApiError } from "./errors";

/** `order` (solutions only): every solution id, most important first, each with a short reason. */
export interface SupportPlan { text: string; model: string; generatedAt: string; order?: { id: string; reason: string }[] }

interface Catalog { circumstances: CircumstanceDefinition[]; recommendations: RecommendationDefinition[]; supportAreas: { id: string; label: string }[] }

export type PlanKind = "support" | "signals" | "solutions";
export const PLAN_KINDS: PlanKind[] = ["support", "signals", "solutions"];

const COMMON = [
  "You help staff at an Australian electricity retailer support customers who may be in hardship.",
  "Write ONE short paragraph for the support worker. Use only the facts given; do not invent amounts, dates or programs.",
  "Plain, kind, practical language. Never judge the customer. No headings or lists. Write dates like 10 Oct 2026.",
  "Anything marked safety must be passed to trained staff, not handled in the call.",
].join(" ");

const TASK: Record<PlanKind, string> = {
  support: "In 60 to 100 words: what seems to be going on, what to offer first and why, and anything to handle with care. Speak to the worker (\"Start by…\").",
  signals: "In 40 to 70 words: what these account signals show together about the customer's situation, which matter most, and what to check with the customer. Do not recommend specific programs.",
  solutions: "In 50 to 90 words: which solutions to offer first and why, how to bring them up, and what eligibility to check before offering. Only mention solutions in the list. " +
    "Also order EVERY solution id in the list by priority and impact for this customer (stopping harm such as disconnection or safety risks first, then the biggest, quickest relief), each with a reason of at most 12 words. " +
    "Each reason must be about THIS customer's circumstances and signals only; never mention eligibility groups or situations from a solution's key facts that the case does not show. " +
    "Answer as JSON: {\"summary\": string, \"order\": [{\"id\": string, \"reason\": string}]}.",
};

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const readable = (t: string) => t.replace(ISO, (_m, y: string, mo: string, d: string) => `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`);

/** The facts for one kind of summary, as plain text; empty when there is nothing to summarise. */
export function planFacts(kind: PlanKind, c: QueueCase, person: Person | null, cat: Catalog, asOf: string): string {
  if (kind === "signals") {
    const signals = person?.account ? detectAccountSignals(person.account, asOf) : [];
    return readable(signals.map((s) => `Signal: ${s.name} — ${s.evidence}`).join("\n"));
  }
  if (kind === "solutions") {
    const def = (id: string) => cat.circumstances.find((d) => d.id === id);
    return readable(c.recommendations.map((r) => {
      const d = cat.recommendations.find((x) => x.id === r.recommendationId);
      const forNames = r.circumstanceIds.map((id) => def(id)?.label ?? id).join(", ");
      return [`Solution [id ${r.recommendationId}]: ${d?.label ?? r.recommendationId} (for ${forNames})`, d?.provider ? `  Provider: ${d.provider}` : "", d?.description ? `  Key facts: ${d.description}` : "", d?.howToAccess ? `  How to access: ${d.howToAccess}` : ""].filter(Boolean).join("\n");
    }).join("\n"));
  }
  return readable(supportFacts(c, person, cat));
}

function supportFacts(c: QueueCase, person: Person | null, cat: Catalog): string {
  const def = (id: string) => cat.circumstances.find((d) => d.id === id);
  const lines: string[] = [];
  if (c.modelAssessment.priority) lines.push(`Priority: ${c.modelAssessment.priority.score}/100 (${c.modelAssessment.priority.label}), trend ${c.modelAssessment.trend ?? "unknown"}.`);
  for (const x of c.circumstances) {
    const d = def(x.circumstanceId);
    const area = cat.supportAreas.find((a) => a.id === d?.supportAreaId)?.label;
    lines.push(`Circumstance: ${d?.label ?? x.circumstanceId}${area ? ` (${area})` : ""}${d?.sensitivity && d.sensitivity !== "standard" ? `, ${d.sensitivity}` : ""}.`);
    if (d?.handling) lines.push(`  Handling: ${d.handling}`);
    for (const s of x.signals ?? []) lines.push(`  Signal (${s.strength}): ${s.name}${s.evidence ? ` — ${s.evidence}` : ""}`);
  }
  for (const r of c.recommendations) {
    const d = cat.recommendations.find((x) => x.id === r.recommendationId);
    const forNames = r.circumstanceIds.map((id) => def(id)?.label ?? id).join(", ");
    lines.push(`Solution: ${d?.label ?? r.recommendationId} (for ${forNames})${d?.description ? ` — ${d.description}` : ""}`);
  }
  const a = person?.account;
  if (a) {
    const cp = a.contactPreferences;
    lines.push(`Contact: prefers ${cp.preferredChannel}${cp.doNotCall ? ", do not call" : ""}${a.interpreterRequired ? ", interpreter required" : ""}${a.lifeSupport ? ", life support registered" : ""}.`);
  }
  return lines.join("\n");
}

const ORDER_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    order: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, reason: { type: "STRING" } }, required: ["id", "reason"] } },
  },
  required: ["summary", "order"],
};

/**
 * Calls the Gemini API. Throws an ApiError the page can show when the key is missing or the call fails.
 * For solutions, `ids` are the case's solutions: the order is kept only if it has exactly those, each once.
 */
export async function draftPlan(kind: PlanKind, facts: string, apiKey: string | null, model: string, ids: string[] = []): Promise<SupportPlan> {
  if (!apiKey) throw new ApiError("unavailable", "AI plans are switched off: no Gemini API key is set on the server.");
  const call = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${COMMON} ${TASK[kind]}` }] },
        contents: [{ role: "user", parts: [{ text: facts }] }],
        generationConfig: { temperature: 0.3, ...(kind === "solutions" ? { responseMimeType: "application/json", responseSchema: ORDER_SCHEMA } : {}) },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  // Gemini's busy (503) and server errors are usually brief: try once more after a short wait.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000));
    try { res = await call(); } catch { res = null; continue; }
    if (res.status < 500) break;
  }
  if (!res) throw new ApiError("unavailable", "Could not reach Gemini. Try again in a moment.");
  if (res.status === 429) throw new ApiError("unavailable", "Gemini's free limit was reached. Try again in a minute.");
  const json = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new ApiError("unavailable", `Gemini returned an error (${res.status})${json?.error?.message ? `: ${json.error.message}` : ""}.`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ApiError("unavailable", "Gemini returned no text.");
  const generatedAt = new Date().toISOString();
  if (kind !== "solutions") return { text, model, generatedAt };
  let parsed: { summary?: unknown; order?: { id?: unknown; reason?: unknown }[] };
  try { parsed = JSON.parse(text); } catch { throw new ApiError("unavailable", "Gemini's answer could not be read."); }
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) throw new ApiError("unavailable", "Gemini returned no summary.");
  const order = (Array.isArray(parsed.order) ? parsed.order : []).map((o) => ({ id: String(o.id ?? ""), reason: String(o.reason ?? "").trim() }));
  const valid = order.length === ids.length && new Set(order.map((o) => o.id)).size === ids.length && order.every((o) => ids.includes(o.id));
  return { text: parsed.summary.trim(), model, generatedAt, ...(valid ? { order } : {}) };
}
