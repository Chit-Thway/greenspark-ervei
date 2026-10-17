import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export const FIXTURE_PATH = process.env.GREENSPARK_FIXTURE ?? `${root}data/synthetic/case-queue.v1.json`;
export const DB_PATH = process.env.GREENSPARK_DB ?? `${root}data/runtime/greenspark.sqlite`;
export const PORT = Number(process.env.PORT ?? 3001);


// Built web app, served by this process when present (single-process hosting, e.g. Render).
const webDist = process.env.GREENSPARK_WEB_DIST ?? `${root}web/dist`;
export const WEB_DIST = existsSync(`${webDist}/index.html`) ? webDist : null;

// Optional "user:password" gate for shared demo hosting. Unset locally.
export const BASIC_AUTH = process.env.GREENSPARK_BASIC_AUTH || null;
