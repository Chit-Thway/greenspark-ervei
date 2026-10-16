// The only module that reads the checked-in fixture. Components use QueueDataset via this adapter;
// Milestone 4 replaces the body of loadDataset() with API calls.
import fixture from "@fixture/case-queue.v1.json";
import { toDataset, type QueueDataset, type RawFixture } from "@greenspark/shared";

export async function loadDataset(): Promise<QueueDataset> {
  return toDataset(structuredClone(fixture) as unknown as RawFixture);
}
