import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // In development the API runs separately on port 3001; /api is proxied so the browser sees one origin.
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:3001" } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
