import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Google Gemini, for the AI support plan on each case. Unset key: the plan is switched off.
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
// Flash-Lite for both: it is far less often overloaded than Flash. Set GEMINI_MODEL to use another model for the plan.
export const GEMINI_MODELS = {
  support: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  signals: process.env.GEMINI_SIGNALS_MODEL || "gemini-flash-lite-latest",
};

// Weather signals: "demo" (the default) uses a built-in sample heatwave, "live" fetches Bureau of Meteorology
// forecasts hourly, "off" turns them off. This is the mode at start-up; it can be switched on the Data sources page.
export const WEATHER_MODE = (["live", "demo", "off"].includes(process.env.WEATHER_MODE ?? "") ? process.env.WEATHER_MODE : "demo") as "live" | "demo" | "off";
