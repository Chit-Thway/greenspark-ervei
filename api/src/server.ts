import { createApp } from "./app";
import { DB_PATH, FIXTURE_PATH, PORT, PROFILE_URL_TEMPLATE, WEB_DIST, BASIC_AUTH } from "./config";
import { Store } from "./store";

const store = new Store(DB_PATH, FIXTURE_PATH);
const server = createApp(store, { profileUrlTemplate: PROFILE_URL_TEMPLATE, staticDir: WEB_DIST, basicAuth: BASIC_AUTH }).listen(PORT, "0.0.0.0", () => {
  console.log(`GreenSpark API (synthetic demo data) on http://localhost:${PORT}`);
  console.log(`Workflow database: ${DB_PATH}`);
  if (WEB_DIST) console.log(`Serving web app from ${WEB_DIST}`);
  if (BASIC_AUTH) console.log("HTTP Basic auth is ON");
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { server.close(() => { store.close(); process.exit(0); }); });
}
