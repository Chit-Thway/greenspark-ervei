import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const fixtureDir = fileURLToPath(new URL("../data/synthetic", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@fixture": fixtureDir } },
  server: { fs: { allow: [".."] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
