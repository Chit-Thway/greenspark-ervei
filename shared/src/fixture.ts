import type { QueueDataset } from "./types";

/** Shape of data/synthetic/case-queue.v1.json (only the parts the apps use). */
export interface RawFixture {
  metadata: { asOf: string; isSynthetic: boolean; datasetId: string };
  users: QueueDataset["users"];
  supportAreas: QueueDataset["supportAreas"];
  circumstanceDefinitions: QueueDataset["circumstances"];
  evidenceFieldDefinitions: QueueDataset["evidenceFields"];
  recommendationDefinitions: QueueDataset["recommendations"];
  people: QueueDataset["people"];
  cases: QueueDataset["cases"];
}

export function toDataset(raw: RawFixture): QueueDataset {
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
