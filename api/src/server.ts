import { createApp } from "./app";
import { DB_PATH, FIXTURE_PATH, PORT } from "./config";
import { Store } from "./store";

const store = new Store(DB_PATH, FIXTURE_PATH);
const server = createApp(store).listen(PORT, () => {
  console.log(`GreenSpark API (synthetic demo data) on http://localhost:${PORT}`);
  console.log(`Workflow database: ${DB_PATH}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { server.close(() => { store.close(); process.exit(0); }); });
}
