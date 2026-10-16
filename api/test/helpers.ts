import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { FIXTURE_PATH } from "../src/config";
import { Store } from "../src/store";

export class TestClock {
  constructor(public time = new Date("2026-10-16T02:00:00Z")) {}
  now = () => new Date(this.time);
  advance(ms: number) { this.time = new Date(this.time.getTime() + ms); }
}

export async function start(dbPath = ":memory:", clock = new TestClock()) {
  const store = new Store(dbPath, FIXTURE_PATH);
  const server: Server = await new Promise((resolve) => {
    const s = createApp(store, clock.now).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function call(user: string | null, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(user ? { "x-demo-user": user } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }
  return {
    store, clock, call,
    stop: async () => { await new Promise((r) => server.close(r)); store.close(); },
  };
}

export type Harness = Awaited<ReturnType<typeof start>>;

/** All cases through the API, so tests find real fixture records instead of hard-coding them. */
export async function allCases(h: Harness) {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const r = await h.call("staff-manager", "GET", `/api/cases?pageSize=100&page=${page}`);
    out.push(...r.body.items.map((i: any) => i.case));
    if (page >= r.body.pageCount) return out;
  }
}
