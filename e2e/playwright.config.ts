import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const RUNTIME = resolve(import.meta.dirname, ".runtime");

const API_PORT = 3101;
const WEB_PORT = 5273;

// Starts a throwaway API (fresh SQLite file, reseeded from the fixture) and the web app, then drives a real browser.
export default defineConfig({
  testDir: "tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    // Set PW_CHROMIUM_PATH to use a specific Chromium; otherwise Playwright's own browser is used.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: `rm -rf ${RUNTIME} && npm run start -w api`,
      cwd: "..",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: { PORT: String(API_PORT), GREENSPARK_DB: `${RUNTIME}/e2e.sqlite`, GREENSPARK_PROFILE_URL_TEMPLATE: "https://profiles.example/people/{personId}" },
    },
    {
      command: `npm run dev -w web -- --port ${WEB_PORT} --strictPort`,
      cwd: "..",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
