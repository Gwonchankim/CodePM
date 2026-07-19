import type { RequestedAction } from "../domain/actions.js";
import type { RiskLevel } from "../domain/types.js";

export const APPROVAL_EVIDENCE_SCHEMA_VERSION = "codepm.approval.v1";

export interface ApprovalScope {
  repo?: string;
  remote?: string;
  branch?: string;
  prNumber?: number;
  expectedHeadSha?: string;
  forcePush?: boolean;
  filesChanged: string[];
}

export interface ApprovalEvidence {
  schemaVersion: typeof APPROVAL_EVIDENCE_SCHEMA_VERSION;
  approver: string;
  approvedAt: string;
  expiresAt: string;
  requestedAction: RequestedAction;
  riskLevel: RiskLevel;
  scope: ApprovalScope;
}

const mutationActions = new Set<RequestedAction>([
  "push_branch",
  "create_pr",
  "merge_pr"
]);

export function isHumanApprovalRequired(
  requestedAction: RequestedAction,
  riskLevel: RiskLevel
): boolean {
  return mutationActions.has(requestedAction) && riskLevel !== "low";
}

export function normalizeApprovalFiles(files: string[]): string[] {
  return [...new Set(files.map(normalizeApprovalPath).filter(Boolean))].sort();
}

export function normalizeApprovalPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}
