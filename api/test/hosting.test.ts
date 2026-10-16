import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { FIXTURE_PATH } from "../src/config";
import { Store } from "../src/store";

async function serve(options: Parameters<typeof createApp>[1]) {
  const store = new Store(":memory:", FIXTURE_PATH);
  const server = await new Promise<import("node:http").Server>((r) => { const s = createApp(store, options).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, stop: async () => { await new Promise((r) => server.close(r)); store.close(); } };
}

describe("single-process hosting", () => {
  it("serves the built web app and falls back to index.html, but never for /api", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-web-"));
    writeFileSync(join(dir, "index.html"), "<html>app shell</html>");
    const h = await serve({ staticDir: dir });
    try {
      expect(await (await fetch(h.base + "/")).text()).toContain("app shell");
      expect(await (await fetch(h.base + "/some/deep/link")).text()).toContain("app shell");
      const api = await fetch(h.base + "/api/nope", { headers: { "x-demo-user": "staff-manager" } });
      expect(api.status).toBe(404);
      expect(((await api.json()) as { error: { code: string } }).error.code).toBe("not_found");
    } finally { await h.stop(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("protects everything but the health check when basic auth is set", async () => {
    const h = await serve({ basicAuth: "demo:s3cret" });
    try {
      expect((await fetch(h.base + "/api/health")).status).toBe(200);
      const none = await fetch(h.base + "/api/cases", { headers: { "x-demo-user": "staff-manager" } });
      expect(none.status).toBe(401);
      expect(none.headers.get("www-authenticate")).toMatch(/Basic/);
      const wrong = await fetch(h.base + "/api/cases", { headers: { "x-demo-user": "staff-manager", authorization: "Basic " + Buffer.from("demo:wrong").toString("base64") } });
      expect(wrong.status).toBe(401);
      const ok = await fetch(h.base + "/api/cases", { headers: { "x-demo-user": "staff-manager", authorization: "Basic " + Buffer.from("demo:s3cret").toString("base64") } });
      expect(ok.status).toBe(200);
    } finally { await h.stop(); }
  });
});
