import { createApp } from "./app";
import { ACCOUNTS_PATH, DB_PATH, FIXTURE_PATH, PORT, WEB_DIST, BASIC_AUTH, FLOW_FILE, AI, WEATHER_MODE } from "./config";
import { Store } from "./store";
import { WeatherService } from "./weather";

const store = new Store(DB_PATH, FIXTURE_PATH, ACCOUNTS_PATH);
const weather = new WeatherService(WEATHER_MODE);
weather.start();
const server = createApp(store, { flowFile: FLOW_FILE, staticDir: WEB_DIST, basicAuth: BASIC_AUTH, ai: AI, weather }).listen(PORT, "0.0.0.0", () => {
  console.log(`GreenSpark API (synthetic demo data) on http://localhost:${PORT}`);
  console.log(`Workflow database: ${DB_PATH}`);
  if (WEB_DIST) console.log(`Serving web app from ${WEB_DIST}`);
  if (BASIC_AUTH) console.log("HTTP Basic auth is ON");
  console.log(AI.apiKey ? `AI summaries: ${AI.provider} (${AI.models.support})` : `AI summaries are OFF: no ${AI.provider === "claude" ? "ANTHROPIC" : "GEMINI"}_API_KEY set`);
  console.log(`Weather signals: ${WEATHER_MODE}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { server.close(() => { store.close(); process.exit(0); }); });
}
