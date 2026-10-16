export type ErrorCode =
  | "unauthenticated" | "forbidden" | "not_found" | "validation_failed"
  | "bulk_validation_failed" | "version_conflict" | "undo_conflict";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, validation_failed: 422,
  bulk_validation_failed: 422, version_conflict: 409, undo_conflict: 409,
};

export interface ErrorDetail { caseId?: string; code?: string; message: string }

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details: ErrorDetail[] = [], readonly extra?: unknown) {
    super(message);
    this.status = STATUS[code];
  }
}
