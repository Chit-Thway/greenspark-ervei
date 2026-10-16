// Debug-only latency injection for reproducing workflow races without changing app code.
// node scripts/debug-workflow-proxy.mjs
// Point the web server's API_URL to http://127.0.0.1:3102.
// Write {"rules":[{"method":"GET","path":"/api/cases/GS-2011/overview","delayMs":4000}]}
// to /private/tmp/greenspark-debug-proxy.json. Only response delivery is delayed.
import http from "node:http";
import { readFileSync } from "node:fs";

const control = process.env.DEBUG_PROXY_CONTROL ?? "/private/tmp/greenspark-debug-proxy.json";
const target = new URL(process.env.DEBUG_API_TARGET ?? "http://127.0.0.1:3101");
const server = http.createServer((req, res) => {
  let rules = [];
  try { rules = JSON.parse(readFileSync(control, "utf8")).rules ?? []; } catch {}
  const rule = rules.find((r) => r.method === req.method && new RegExp(r.path).test(req.url));
  const upstream = http.request(new URL(req.url, target), { method: req.method, headers: req.headers }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      setTimeout(() => {
        res.writeHead(response.statusCode, response.headers);
        res.end(Buffer.concat(chunks));
        console.log(`${req.method} ${req.url} -> ${response.statusCode}; delay=${rule?.delayMs ?? 0}ms`);
      }, rule?.delayMs ?? 0);
    });
  });
  upstream.on("error", (error) => { res.writeHead(502); res.end(error.message); });
  req.pipe(upstream);
});
server.listen(3102, "127.0.0.1", () => console.log("Debug response-delay proxy on 127.0.0.1:3102"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
