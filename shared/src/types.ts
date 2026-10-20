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
  // Set when the definition comes from the flowchart.
  sensitivity?: "standard" | "sensitive" | "safety";
  type?: string;
  handling?: string | null;
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
  // Set when the recommendation is a solution from the flowchart.
  provider?: string;
  howToAccess?: string;
  contact?: string;
  sourceUrl?: string | null;
  verified?: boolean;
  lastVerified?: string | null;
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
  /** The customer's main ID on screen (fictional, DEMO-7xxxxx). Every person has one, including people added in the queue. */
  accountNumber?: string | null;
  // Fictional utility account. Missing for people added in the queue.
  account?: CustomerAccount | null;
}

export type PaymentMethod = "direct_debit" | "card" | "bpay" | "centrepay" | "cash_counter";

export interface Bill {
  id: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  usageKwh: number;
  usageKwhLastYear: number;
  estimatedRead: boolean;
  amount: number;
  amountPaid: number;
  paidInFullAt: string | null;
}

export interface Payment { date: string; amount: number; method: PaymentMethod; status: "cleared" | "dishonoured" }

export interface CustomerAccount {
  utility: string;
  customerSince: string;
  dateOfBirth: string;
  supplyType: "standard" | "embedded";
  plan: { type: "postpaid" | "prepaid"; name: string; billingCycle: "bimonthly" | null };
  tariff: { centsPerKwh: number; supplyCentsPerDay: number; provenance: string };
  paymentMethod: PaymentMethod;
  concession: { status: "active" | "lapsed" | "none"; type: string | null; endDate: string | null };
  thirdPartyAuthority: { type: string; name: string; since: string } | null;
  lifeSupport: boolean;
  accessNeeds: string | null;
  languagePreference: string;
  interpreterUsed: boolean;
  hardshipProgram: { status: "none" | "active" | "exited"; exitReason: string | null; assessmentOffered: boolean };
  paymentPlan: { status: "active" | "broken" | "completed"; startedAt: string; frequency: string; instalment: number } | null;
  extensions: { requestedAt: string }[];
  bills: Bill[];
  payments: Payment[];
  usage: { month: string; kWh: number; kWhLastYear: number }[];
  prepay: { recharges: { date: string; amount: number; method: PaymentMethod }[]; zeroCreditEvents: string[] } | null;
  contacts: { date: string; channel: string; topic: string }[];
  complaintOpen: boolean;
  disconnectionWarningAt: string | null;
  collectionsStatus: string | null;
  digital: { lastLoginAt: string | null; lastEmailOpenAt: string | null };
  returnedMail: boolean;
}

/** A flow signal seen for a case: from the account, or from a survey answer that matches a self-report signal. */
export interface CaseSignal {
  id: string;
  name: string;
  source: "account" | "self_report";
  strength: "strong" | "supporting";
  evidence: string;
  evidenceFieldId?: string;
}

export interface CaseCircumstance {
  circumstanceId: string;
  evidenceFieldIds: string[];
  /** The flow signals that raised this circumstance (flow-based cases only). */
  signals?: CaseSignal[];
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
  /** Set once a note has been edited. Earlier wording is kept on the server as an audit record. */
  editedAt?: string | null;
  editedByUserId?: string | null;
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
  /** "flow": circumstances and solutions come from the flowchart file. "fixture": the fixture's fixed survey rules. */
  circumstanceSource?: "flow" | "fixture";
  isSynthetic: boolean;
  users: StaffUser[];
  supportAreas: SupportArea[];
  circumstances: CircumstanceDefinition[];
  evidenceFields: EvidenceFieldDefinition[];
  recommendations: RecommendationDefinition[];
  people: Person[];
  cases: QueueCase[];
}

export type QueueView = "all" | "mine" | "needs_review";
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
