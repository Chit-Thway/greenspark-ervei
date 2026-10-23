import { afterEach, describe, expect, it, vi } from "vitest";
import { draftPlan, type AiConfig } from "../src/plan";

const answer = { summary: "Start by calling.", order: [{ id: "r1", reason: "Power is off", dueInWorkingDays: 0, method: "sms" }] };
const models = { support: "test-model", signals: "test-model" };

/** Replaces fetch with one that records each request and replies with `body`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("draftPlan", () => {
  it("is switched off without a key", async () => {
    await expect(draftPlan("signals", "facts", { provider: "claude", apiKey: null, models })).rejects.toThrow(/switched off/);
    await expect(draftPlan("signals", "facts", null)).rejects.toThrow(/switched off/);
  });

  it("asks Claude for the plan as JSON and checks the answer", async () => {
    const calls = fakeFetch(200, {
      id: "msg_1", type: "message", role: "assistant", model: "test-model", stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ai: AiConfig = { provider: "claude", apiKey: "sk-test", models };
    const plan = await draftPlan("support", "facts", ai, ["r1"], undefined, "2026-10-23");
    expect(calls[0].url).toContain("api.anthropic.com/v1/messages");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe("test-model");
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.temperature).toBeUndefined();
    expect(plan.text).toBe("Start by calling.");
    expect(plan.order).toEqual([{ id: "r1", reason: "Power is off", due: "2026-10-23", method: "phone" }]);
  });

  it("explains a Claude refusal", async () => {
    fakeFetch(200, {
      id: "msg_1", type: "message", role: "assistant", model: "test-model", stop_reason: "refusal", stop_sequence: null,
      content: [], usage: { input_tokens: 1, output_tokens: 0 },
    });
    await expect(draftPlan("signals", "facts", { provider: "claude", apiKey: "sk-test", models })).rejects.toThrow(/Claude declined/);
  });

  it("asks Gemini when it is the chosen service", async () => {
    const calls = fakeFetch(200, { candidates: [{ content: { parts: [{ text: "The signals show arrears." }] } }] });
    const plan = await draftPlan("signals", "facts", { provider: "gemini", apiKey: "g-test", models });
    expect(calls[0].url).toContain("generativelanguage.googleapis.com");
    expect(plan.text).toBe("The signals show arrears.");
  });
});
