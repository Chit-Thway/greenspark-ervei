// Starts the API (3001) and the web app (5173) together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const procs = [
  ["api", ["run", "dev", "-w", "api"]],
  ["web", ["run", "dev", "-w", "web"]],
].map(([name, args]) => {
  const p = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk) => String(chunk).split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on("data", tag);
  p.stderr.on("data", tag);
  p.on("exit", (code) => { console.log(`[${name}] exited (${code ?? "signal"})`); stop(); });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
