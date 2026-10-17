export type Role = "manager" | "support_worker";
export type CaseStatus = "new" | "in_progress" | "waiting" | "resolved";
export type ReviewStatus = "needs_review" | "reviewed";
export type PriorityLabel = "urgent" | "high" | "moderate" | "routine";
export type AssessmentStatus = "ready" | "pending" | "unavailable";
export type AnswerAvailability = "recorded" | "not_asked" | "unknown";

export interface StaffUser {
  id: string;
  displayName: string;
  role: Role;
}

export interface SupportArea {
  id: string;
  label: string;
  circumstanceIds: string[];
}

export interface CircumstanceDefinition {
  id: string;
  label: string;
  supportAreaId: string;
  evidenceFieldIds: string[];
  recommendationIds: string[];
  illustrativeRule: string;
}

export interface EvidenceFieldDefinition {
  id: string;
  label: string;
  allowedValues: string[];
  referencePeriod: "past_6_months" | "past_12_months" | "at_report";
}

export interface RecommendationDefinition {
  id: string;
  label: string;
  description: string;
}

export interface Person {
  id: string;
  displayName: string;
  suburb: string;
  state: string;
  householdSummary: string;
  contactPreference: { channel: string; preferredWindow: string; provenance: string } | null;
  fullProfilePath: string | null;
  // Fictional contact details. Missing means "not recorded", never "none"; people added in the queue start without them.
  gender?: string | null;
  preferredName?: string | null;
  address?: { line1: string; line2: string | null; postcode: string } | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface CaseCircumstance {
  circumstanceId: string;
  evidenceFieldIds: string[];
}

export interface CaseRecommendation {
  recommendationId: string;
  circumstanceIds: string[];
  evidenceFieldIds: string[];
  reviewStatus: "pending" | "reviewed";
}

export interface CaseNote {
  id: string;
  text: string;
  authorUserId: string;
  createdAt: string;
}

export interface ModelAssessment {
  provider: string;
  isSimulated: boolean;
  status: AssessmentStatus;
  priority: { score: number; label: PriorityLabel } | null;
  trend: "rising" | "stable" | "falling" | null;
  explanation: string | null;
}

export interface CaseWorkflow {
  status: CaseStatus;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
  followUpAt: string | null;
  reviewStatus: ReviewStatus;
  notes: CaseNote[];
}

export interface QueueCase {
  id: string;
  personId: string;
  version: number;
  reportedAt: string | null;
  reportedAnswers: Record<string, string | null>;
  answerAvailability: Record<string, AnswerAvailability>;
  supportAreaIds: string[];
  circumstances: CaseCircumstance[];
  assistance: {
    hardshipEnrolmentAtReport: string | null;
    energyBillConcessionAtReport: string | null;
    reportedHistory: { evidenceFieldId: string; referencePeriod: string }[];
  };
  recommendations: CaseRecommendation[];
  modelAssessment: ModelAssessment;
  workflow: CaseWorkflow;
}

export interface QueueDataset {
  asOf: string;
  isSynthetic: boolean;
  users: StaffUser[];
  supportAreas: SupportArea[];
  circumstances: CircumstanceDefinition[];
  evidenceFields: EvidenceFieldDefinition[];
  recommendations: RecommendationDefinition[];
  people: Person[];
  cases: QueueCase[];
}

export type QueueView = "all" | "mine" | "unassigned" | "needs_review";
export type SortKey = "priority_desc" | "priority_asc" | "followup" | "name" | "updated";

export interface QueueQuery {
  search: string;
  view: QueueView;
  circumstanceIds: string[];
  assistanceIds: string[];
  priorityLabels: PriorityLabel[];
  minPriorityScore: number;
  assessmentStatus: AssessmentStatus | "";
  status: CaseStatus | "";
  assignedToUserId: string;
  sort: SortKey;
  page: number;
  pageSize: number;
}
