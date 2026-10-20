import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FlowError, applyOp, normalizeDoc, validateDoc, type FlowDoc, type FlowOp } from "@greenspark/shared";
import { ApiError } from "./errors";

export interface FlowSnapshot {
  doc: FlowDoc | null;
  /** Fingerprint of the file's exact contents. It changes whenever the file does, whoever changed it. */
  hash: string;
  /** Reasons the file can't be edited safely. Empty when it is fine. */
  problems: string[];
}

const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The utility hardship flow JSON file. The file is the only copy: every read looks at the file as it is now,
 * and every edit is applied to it and written straight back (to a temporary file first, then renamed, so a
 * crash can't leave half a file). Edits are queued so two people saving at once never overwrite each other.
 */
export class FlowFile {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string) {}

  async read(): Promise<FlowSnapshot> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch {
      return { doc: null, hash: "", problems: [`The flow file could not be read (${this.path}).`] };
    }
    const hash = fingerprint(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { doc: null, hash, problems: [`The flow file is not valid JSON: ${e instanceof Error ? e.message : "parse error"}`] };
    }
    const problems = validateDoc(parsed);
    return { doc: problems.length ? (parsed as FlowDoc) : normalizeDoc(parsed as FlowDoc), hash, problems };
  }

  /** Applies edits in order to the current file. All of them are applied, or none. */
  apply(ops: FlowOp[]): Promise<{ hash: string; previousHash: string; changed: boolean }> {
    const run = this.queue.then(async () => {
      const before = await this.read();
      if (!before.doc || before.problems.length) {
        throw new ApiError("validation_failed", "The flow file has problems, so it can't be edited until they are fixed.", before.problems.map((message) => ({ message })));
      }
      let doc = before.doc;
      try {
        for (const op of ops) doc = applyOp(doc, op);
      } catch (e) {
        if (e instanceof FlowError) throw new ApiError("validation_failed", e.message, [{ message: e.message }, ...e.details.map((message) => ({ message }))]);
        throw e;
      }
      const next = JSON.stringify(doc, null, 2);
      const current = await readFile(this.path, "utf8");
      if (next === current) return { hash: before.hash, previousHash: before.hash, changed: false };
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(temp, next, "utf8");
      await rename(temp, this.path);
      return { hash: fingerprint(next), previousHash: before.hash, changed: true };
    });
    this.queue = run.catch(() => undefined); // a failed edit must not block the next one
    return run;
  }
}
