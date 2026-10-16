import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export const FIXTURE_PATH = process.env.GREENSPARK_FIXTURE ?? `${root}data/synthetic/case-queue.v1.json`;
export const DB_PATH = process.env.GREENSPARK_DB ?? `${root}data/runtime/greenspark.sqlite`;
export const PORT = Number(process.env.PORT ?? 3001);

// Optional link to the teammate-owned full profile, e.g. https://profiles.example/people/{personId}
export const PROFILE_URL_TEMPLATE = process.env.GREENSPARK_PROFILE_URL_TEMPLATE || null;
