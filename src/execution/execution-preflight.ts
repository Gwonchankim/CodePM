import { appendAuditEntry, createAuditEntry } from "../audit/audit-writer.js";
import type { RequestedAction } from "../domain/actions.js";
import type { AuditEntry, Decision, RiskLevel } from "../domain/types.js";
import type { ApprovalEvidence } from "../policy/approval-evidence.js";
import { isHumanApprovalRequired } from "../policy/approval-evidence.js";
import {
  validateApprovalEvidence,
  type ApprovalValidationErrorCode
} from "../policy/approval-validator.js";
import {
  compareExecutionScopes,
  type ExecutionScope
} from "./execution-scope.js";

export type ExecutionPreflightFindingCode =
  | ApprovalValidationErrorCode
  | "action_mismatch"
  | "scope_mismatch";

export interface ExecutionPreflightFinding {
  code: ExecutionPreflightFindingCode;
  message: string;
  field?: string;
}

export interface ExecutionPreflightInput {
  decision: Decision;
  approvedAction: RequestedAction;
  requestedAction: RequestedAction;
  riskLevel: RiskLevel;
  reviewedScope: ExecutionScope;
  currentScope: ExecutionScope;
  approval?: ApprovalEvidence;
  now?: string;
  auditLogPath?: string;
  testEvidence?: string;
}

export type ExecutionPreflightResult =
  | {
      ok: true;
      status: "allow";
      approvalRequired: boolean;
      findings: [];
      beforeAuditEntry: AuditEntry;
      afterAuditEntry: AuditEntry;
    }
  | {
      ok: false;
      status: "block";
      approvalRequired: boolean;
      findings: ExecutionPreflightFinding[];
      beforeAuditEntry: AuditEntry;
      afterAuditEntry: AuditEntry;
    };

export function runExecutionPreflight(
  input: ExecutionPreflightInput
): ExecutionPreflightResult {
  const approvalRequired = isHumanApprovalRequired(
    input.requestedAction,
    input.riskLevel
  );
  const beforeAuditEntry = createPreflightAuditEntry({
    input,
    decision: input.decision.decision,
    reason: `Execution preflight started for ${input.requestedAction}.`,
    approvalRequired,
    humanApprovalGranted: getHumanApprovalGranted(input.approval)
  });

  const findings = collectPreflightFindings(input);
  const allowed = findings.length === 0;
  const afterAuditEntry = createPreflightAuditEntry({
    input,
    decision: allowed ? "approve" : "block",
    reason: allowed
      ? `Execution preflight allowed ${input.requestedAction}.`
      : `Execution preflight blocked ${input.requestedAction}: ${findings.map((finding) => finding.message).join(" ")}`,
    approvalRequired,
    humanApprovalGranted: allowed
      ? getHumanApprovalGranted(input.approval)
      : false
  });

  appendAuditIfRequested(input.auditLogPath, beforeAuditEntry, afterAuditEntry);

  if (!allowed) {
    return {
      ok: false,
      status: "block",
      approvalRequired,
      findings,
      beforeAuditEntry,
      afterAuditEntry
    };
  }

  return {
    ok: true,
    status: "allow",
    approvalRequired,
    findings: [],
    beforeAuditEntry,
    afterAuditEntry
  };
}

function collectPreflightFindings(
  input: ExecutionPreflightInput
): ExecutionPreflightFinding[] {
  const findings: ExecutionPreflightFinding[] = [];

  if (input.approvedAction !== input.requestedAction) {
    findings.push({
      code: "action_mismatch",
      message: `PM decision approved ${input.approvedAction}, not ${input.requestedAction}.`,
      field: "requestedAction"
    });
  }

  findings.push(
    ...compareExecutionScopes(input.reviewedScope, input.currentScope).map(
      (mismatch) => ({
        code: "scope_mismatch" as const,
        message: mismatch.message,
        field: `currentScope.${mismatch.field}`
      })
    )
  );

  const approvalResult = validateApprovalEvidence({
    decision: input.decision,
    requestedAction: input.requestedAction,
    riskLevel: input.riskLevel,
    currentScope: input.currentScope,
    approval: input.approval,
    now: input.now
  });

  if (!approvalResult.ok) {
    findings.push(
      ...approvalResult.errors.map((error) => ({
        code: error.code,
        message: error.message,
        field: error.field
      }))
    );
  }

  return findings;
}

function createPreflightAuditEntry(input: {
  input: ExecutionPreflightInput;
  decision: AuditEntry["decision"];
  reason: string;
  approvalRequired: boolean;
  humanApprovalGranted: boolean | null;
}): AuditEntry {
  return createAuditEntry({
    timestamp: input.input.now ?? new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: input.input.requestedAction,
    decision: input.decision,
    reason: input.reason,
    filesChanged: input.input.currentScope.filesChanged,
    riskLevel: input.input.riskLevel,
    testEvidence: input.input.testEvidence ?? input.input.decision.summary,
    github: toAuditGithubContext(input.input.currentScope),
    humanApprovalRequired: input.approvalRequired,
    humanApprovalGranted: input.humanApprovalGranted
  });
}

function toAuditGithubContext(
  scope: ExecutionScope
): Record<string, unknown> | null {
  if (!scope.repo && !scope.prNumber && !scope.expectedHeadSha && !scope.branch) {
    return null;
  }

  return {
    repo: scope.repo,
    remote: scope.remote,
    branch: scope.branch,
    prNumber: scope.prNumber,
    expectedHeadSha: scope.expectedHeadSha,
    forcePush: scope.forcePush
  };
}

function getHumanApprovalGranted(
  approval: ApprovalEvidence | undefined
): boolean | null {
  return approval ? true : null;
}

function appendAuditIfRequested(
  auditLogPath: string | undefined,
  beforeAuditEntry: AuditEntry,
  afterAuditEntry: AuditEntry
): void {
  if (!auditLogPath) {
    return;
  }

  appendAuditEntry(auditLogPath, beforeAuditEntry);
  appendAuditEntry(auditLogPath, afterAuditEntry);
}
