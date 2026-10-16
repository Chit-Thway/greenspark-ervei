// The only module that reads the checked-in fixture. Components use QueueDataset via this adapter;
// Milestone 3 replaces the body of loadDataset() with API calls.
import fixture from "@fixture/case-queue.v1.json";
import type { QueueDataset } from "../domain/types";

interface RawFixture {
  metadata: { asOf: string; isSynthetic: boolean };
  users: QueueDataset["users"];
  supportAreas: QueueDataset["supportAreas"];
  circumstanceDefinitions: QueueDataset["circumstances"];
  evidenceFieldDefinitions: QueueDataset["evidenceFields"];
  recommendationDefinitions: QueueDataset["recommendations"];
  people: QueueDataset["people"];
  cases: QueueDataset["cases"];
}

export async function loadDataset(): Promise<QueueDataset> {
  const raw = structuredClone(fixture) as unknown as RawFixture;
  return {
    asOf: raw.metadata.asOf,
    isSynthetic: raw.metadata.isSynthetic,
    users: raw.users,
    supportAreas: raw.supportAreas,
    circumstances: raw.circumstanceDefinitions,
    evidenceFields: raw.evidenceFieldDefinitions,
    recommendations: raw.recommendationDefinitions,
    people: raw.people,
    cases: raw.cases,
  };
}
