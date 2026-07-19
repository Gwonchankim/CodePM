import type { RequestedAction } from "../domain/actions.js";
import type { Decision, RiskLevel } from "../domain/types.js";
import {
  APPROVAL_EVIDENCE_SCHEMA_VERSION,
  isHumanApprovalRequired,
  normalizeApprovalFiles,
  type ApprovalEvidence,
  type ApprovalScope
} from "./approval-evidence.js";

export type ApprovalValidationErrorCode =
  | "decision_not_approved"
  | "approval_missing"
  | "invalid_approval"
  | "approval_expired"
  | "action_mismatch"
  | "risk_mismatch"
  | "scope_mismatch";

export interface ApprovalValidationError {
  code: ApprovalValidationErrorCode;
  message: string;
  field?: string;
}

export interface ApprovalValidationInput {
  decision: Decision;
  requestedAction: RequestedAction;
  riskLevel: RiskLevel;
  currentScope: ApprovalScope;
  approval?: ApprovalEvidence;
  now?: string;
}

export type ApprovalValidationResult =
  | {
      ok: true;
      approvalRequired: boolean;
      approval: ApprovalEvidence | undefined;
    }
  | {
      ok: false;
      approvalRequired: boolean;
      errors: ApprovalValidationError[];
    };

export function validateApprovalEvidence(
  input: ApprovalValidationInput
): ApprovalValidationResult {
  const approvalRequired = isHumanApprovalRequired(
    input.requestedAction,
    input.riskLevel
  );
  const errors: ApprovalValidationError[] = [];

  if (input.decision.decision !== "approve") {
    errors.push({
      code: "decision_not_approved",
      message: "Execution requires an approved PM decision.",
      field: "decision"
    });
  }

  if (!input.approval) {
    if (approvalRequired) {
      errors.push({
        code: "approval_missing",
        message:
          "Human approval evidence is required for medium-risk and high-risk mutation actions.",
        field: "approval"
      });
    }

    return errors.length > 0
      ? { ok: false, approvalRequired, errors }
      : { ok: true, approvalRequired, approval: undefined };
  }

  errors.push(...validateApprovalShape(input.approval));
  errors.push(
    ...validateApprovalContext({
      approval: input.approval,
      requestedAction: input.requestedAction,
      riskLevel: input.riskLevel,
      currentScope: input.currentScope,
      now: input.now
    })
  );

  return errors.length > 0
    ? { ok: false, approvalRequired, errors }
    : { ok: true, approvalRequired, approval: input.approval };
}

function validateApprovalShape(
  approval: ApprovalEvidence
): ApprovalValidationError[] {
  const errors: ApprovalValidationError[] = [];

  if (approval.schemaVersion !== APPROVAL_EVIDENCE_SCHEMA_VERSION) {
    errors.push({
      code: "invalid_approval",
      message: `Approval evidence must use schema ${APPROVAL_EVIDENCE_SCHEMA_VERSION}.`,
      field: "schemaVersion"
    });
  }

  if (approval.approver.trim().length === 0) {
    errors.push({
      code: "invalid_approval",
      message: "Approval evidence must record a non-empty approver.",
      field: "approver"
    });
  }

  if (!isValidTimestamp(approval.approvedAt)) {
    errors.push({
      code: "invalid_approval",
      message: "Approval evidence approvedAt must be a valid timestamp.",
      field: "approvedAt"
    });
  }

  if (!isValidTimestamp(approval.expiresAt)) {
    errors.push({
      code: "invalid_approval",
      message: "Approval evidence expiresAt must be a valid timestamp.",
      field: "expiresAt"
    });
  }

  return errors;
}

function validateApprovalContext(input: {
  approval: ApprovalEvidence;
  requestedAction: RequestedAction;
  riskLevel: RiskLevel;
  currentScope: ApprovalScope;
  now?: string;
}): ApprovalValidationError[] {
  const errors: ApprovalValidationError[] = [];

  if (input.approval.requestedAction !== input.requestedAction) {
    errors.push({
      code: "action_mismatch",
      message: `Approval is for ${input.approval.requestedAction}, not ${input.requestedAction}.`,
      field: "requestedAction"
    });
  }

  if (input.approval.riskLevel !== input.riskLevel) {
    errors.push({
      code: "risk_mismatch",
      message: `Approval risk is ${input.approval.riskLevel}, not ${input.riskLevel}.`,
      field: "riskLevel"
    });
  }

  errors.push(...validateScope(input.approval.scope, input.currentScope));
  errors.push(...validateExpiry(input.approval, input.now));

  return errors;
}

function validateScope(
  approvedScope: ApprovalScope,
  currentScope: ApprovalScope
): ApprovalValidationError[] {
  const errors: ApprovalValidationError[] = [];

  compareScopeField(errors, "repo", approvedScope.repo, currentScope.repo);
  compareScopeField(errors, "remote", approvedScope.remote, currentScope.remote);
  compareScopeField(errors, "branch", approvedScope.branch, currentScope.branch);
  compareScopeField(
    errors,
    "prNumber",
    approvedScope.prNumber,
    currentScope.prNumber
  );
  compareScopeField(
    errors,
    "expectedHeadSha",
    approvedScope.expectedHeadSha,
    currentScope.expectedHeadSha
  );
  compareScopeField(
    errors,
    "forcePush",
    approvedScope.forcePush,
    currentScope.forcePush
  );

  const approvedFiles = normalizeApprovalFiles(approvedScope.filesChanged);
  const currentFiles = normalizeApprovalFiles(currentScope.filesChanged);

  if (approvedFiles.join("\n") !== currentFiles.join("\n")) {
    errors.push({
      code: "scope_mismatch",
      message: "Approval file scope does not match the current changed files.",
      field: "scope.filesChanged"
    });
  }

  return errors;
}

function compareScopeField(
  errors: ApprovalValidationError[],
  field: keyof Omit<ApprovalScope, "filesChanged">,
  approvedValue: string | number | boolean | undefined,
  currentValue: string | number | boolean | undefined
): void {
  if (approvedValue !== currentValue) {
    errors.push({
      code: "scope_mismatch",
      message: `Approval scope mismatch for ${field}: approved ${formatValue(approvedValue)}, current ${formatValue(currentValue)}.`,
      field: `scope.${field}`
    });
  }
}

function validateExpiry(
  approval: ApprovalEvidence,
  now: string | undefined
): ApprovalValidationError[] {
  if (!isValidTimestamp(approval.expiresAt)) {
    return [];
  }

  const nowTime = now ? Date.parse(now) : Date.now();

  if (Number.isNaN(nowTime)) {
    return [
      {
        code: "invalid_approval",
        message: "Approval validation time must be a valid timestamp.",
        field: "now"
      }
    ];
  }

  if (nowTime > Date.parse(approval.expiresAt)) {
    return [
      {
        code: "approval_expired",
        message: `Approval expired at ${approval.expiresAt}.`,
        field: "expiresAt"
      }
    ];
  }

  return [];
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function formatValue(value: string | number | boolean | undefined): string {
  return value === undefined ? "undefined" : String(value);
}
