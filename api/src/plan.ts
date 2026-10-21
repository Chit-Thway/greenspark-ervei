// A one-paragraph support plan drafted by Google Gemini from a case's flagged circumstances.
// Only circumstances, signals, solutions and contact settings are sent: never names or contact details.
import type { CircumstanceDefinition, Person, QueueCase, RecommendationDefinition } from "@greenspark/shared";
import { ApiError } from "./errors";

export interface SupportPlan { text: string; model: string; generatedAt: string }

interface Catalog { circumstances: CircumstanceDefinition[]; recommendations: RecommendationDefinition[]; supportAreas: { id: string; label: string }[] }

const INSTRUCTION = [
  "You help staff at an Australian electricity retailer support customers who may be in hardship.",
  "From the case facts, write ONE short paragraph (60 to 110 words) for the support worker:",
  "what seems to be going on, what to offer first and why, and anything to handle with care.",
  "Use only the facts given; do not invent amounts, dates or programs. Plain, kind, practical language.",
  "Speak to the worker (\"Start by…\"), never judge the customer, and do not use headings or lists.",
  "Circumstances marked safety must be passed to trained staff, not handled in the call.",
].join(" ");

/** The case facts sent to the model, as plain text. */
export function planFacts(c: QueueCase, person: Person | null, cat: Catalog): string {
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

/** Calls the Gemini API. Throws an ApiError the page can show when the key is missing or the call fails. */
export async function draftPlan(facts: string, apiKey: string | null, model: string): Promise<SupportPlan> {
  if (!apiKey) throw new ApiError("unavailable", "AI plans are switched off: no Gemini API key is set on the server.");
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: facts }] }],
        generationConfig: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError("unavailable", "Could not reach Gemini. Try again in a moment.");
  }
  if (res.status === 429) throw new ApiError("unavailable", "Gemini's free limit was reached. Try again in a minute.");
  const json = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new ApiError("unavailable", `Gemini returned an error (${res.status})${json?.error?.message ? `: ${json.error.message}` : ""}.`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ApiError("unavailable", "Gemini returned no text.");
  return { text, model, generatedAt: new Date().toISOString() };
}
