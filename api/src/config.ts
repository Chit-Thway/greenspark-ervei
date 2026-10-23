import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AiConfig, AiProvider } from "./plan";

const root = fileURLToPath(new URL("../../", import.meta.url));

export const FIXTURE_PATH = process.env.GREENSPARK_FIXTURE ?? `${root}data/synthetic/case-queue.v1.json`;
export const DB_PATH = process.env.GREENSPARK_DB ?? `${root}data/runtime/greenspark.sqlite`;
// The utility hardship flow file edited on the Admin page. Changes are written straight back to it.
export const FLOW_FILE = process.env.GREENSPARK_FLOW_FILE ?? `${root}data/admin/utility_hardship_mapping.json`;
export const PORT = Number(process.env.PORT ?? 3001);


// Built web app, served by this process when present (single-process hosting, e.g. Render).
const webDist = process.env.GREENSPARK_WEB_DIST ?? `${root}web/dist`;
export const WEB_DIST = existsSync(`${webDist}/index.html`) ? webDist : null;

// Optional "user:password" gate for shared demo hosting. Unset locally.
export const BASIC_AUTH = process.env.GREENSPARK_BASIC_AUTH || null;

// The AI summaries on each case: Claude (Anthropic) or Gemini (Google). AI_PROVIDER picks one; unset, Claude is used
// when ANTHROPIC_API_KEY is set, otherwise Gemini. The chosen service's key unset: the summaries are switched off.
const provider: AiProvider = process.env.AI_PROVIDER === "gemini" || (process.env.AI_PROVIDER !== "claude" && !process.env.ANTHROPIC_API_KEY)
  ? "gemini" : "claude";
export const AI: AiConfig = provider === "claude"
  ? {
    provider,
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    // Haiku: fast and the cheapest Claude model, plenty for one-paragraph summaries. CLAUDE_MODEL / CLAUDE_SIGNALS_MODEL override it.
    models: { support: process.env.CLAUDE_MODEL || "claude-haiku-5-5", signals: process.env.CLAUDE_SIGNALS_MODEL || "claude-haiku-5-5" },
  }
  : {
    provider,
    apiKey: process.env.GEMINI_API_KEY || null,
    // Flash-Lite for both: it is far less often overloaded than Flash. GEMINI_MODEL / GEMINI_SIGNALS_MODEL override it.
    models: { support: process.env.GEMINI_MODEL || "gemini-flash-lite-latest", signals: process.env.GEMINI_SIGNALS_MODEL || "gemini-flash-lite-latest" },
  };
