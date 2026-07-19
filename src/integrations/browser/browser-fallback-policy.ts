import type { RiskLevel } from "../../domain/types.js";

export type BrowserFallbackAction =
  | "inspect_github"
  | "create_pr"
  | "merge_pr"
  | "delete_branch"
  | "force_push"
  | "dismiss_review"
  | "production_deploy";

export interface BrowserFallbackTarget {
  repo?: string;
  prNumber?: number;
  branch?: string;
  environment?: string;
  url?: string;
}

export interface BrowserFallbackApproval {
  approved: boolean;
  approver: string;
  approvedAt: string;
  action: BrowserFallbackAction;
  target: BrowserFallbackTarget;
}

export type BrowserFallbackFindingCode =
  | "review_only_command"
  | "structured_adapter_available"
  | "approval_missing"
  | "approval_not_granted"
  | "approval_action_mismatch"
  | "approval_target_mismatch"
  | "browser_action_failed";

export interface BrowserFallbackFinding {
  code: BrowserFallbackFindingCode;
  message: string;
}

export interface BrowserFallbackPolicyInput {
  action: BrowserFallbackAction;
  target: BrowserFallbackTarget;
  sourceCommand: string;
  structuredAdapterAvailable: boolean;
  approval?: BrowserFallbackApproval;
}

export type BrowserFallbackPolicyResult =
  | {
      ok: true;
      status: "allow";
      riskLevel: RiskLevel;
      findings: [];
    }
  | {
      ok: false;
      status: "block";
      riskLevel: RiskLevel;
      findings: BrowserFallbackFinding[];
    };

const reviewOnlyCommands = new Set([
  "review-plan",
  "review-diff",
  "review-pr",
  "review-claude-output",
  "feedback-for-claude"
]);

const highRiskActions = new Set<BrowserFallbackAction>([
  "merge_pr",
  "delete_branch",
  "force_push",
  "dismiss_review",
  "production_deploy"
]);

const mediumRiskActions = new Set<BrowserFallbackAction>(["create_pr"]);

export function evaluateBrowserFallbackPolicy(
  input: BrowserFallbackPolicyInput
): BrowserFallbackPolicyResult {
  const riskLevel = classifyBrowserFallbackRisk(input.action);
  const findings: BrowserFallbackFinding[] = [];

  if (reviewOnlyCommands.has(input.sourceCommand)) {
    findings.push({
      code: "review_only_command",
      message: "Browser fallback cannot be triggered from review-only commands."
    });
  }

  if (input.structuredAdapterAvailable) {
    findings.push({
      code: "structured_adapter_available",
      message:
        "Browser fallback is allowed only when no structured adapter can perform the action."
    });
  }

  if (!input.approval) {
    findings.push({
      code: "approval_missing",
      message: "Browser fallback requires explicit user approval."
    });
  } else {
    findings.push(...validateApproval(input, input.approval));
  }

  if (findings.length > 0) {
    return {
      ok: false,
      status: "block",
      riskLevel,
      findings
    };
  }

  return {
    ok: true,
    status: "allow",
    riskLevel,
    findings: []
  };
}

export function classifyBrowserFallbackRisk(
  action: BrowserFallbackAction
): RiskLevel {
  if (highRiskActions.has(action)) {
    return "high";
  }

  if (mediumRiskActions.has(action)) {
    return "medium";
  }

  return "low";
}

function validateApproval(
  input: BrowserFallbackPolicyInput,
  approval: BrowserFallbackApproval
): BrowserFallbackFinding[] {
  const findings: BrowserFallbackFinding[] = [];

  if (!approval.approved) {
    findings.push({
      code: "approval_not_granted",
      message: "Browser fallback approval must be explicitly granted."
    });
  }

  if (approval.action !== input.action) {
    findings.push({
      code: "approval_action_mismatch",
      message: `Browser fallback approval is for ${approval.action}, not ${input.action}.`
    });
  }

  if (!targetsMatch(approval.target, input.target)) {
    findings.push({
      code: "approval_target_mismatch",
      message: "Browser fallback approval target does not match the requested target."
    });
  }

  return findings;
}

function targetsMatch(
  approvedTarget: BrowserFallbackTarget,
  requestedTarget: BrowserFallbackTarget
): boolean {
  return (
    approvedTarget.repo === requestedTarget.repo &&
    approvedTarget.prNumber === requestedTarget.prNumber &&
    approvedTarget.branch === requestedTarget.branch &&
    approvedTarget.environment === requestedTarget.environment &&
    approvedTarget.url === requestedTarget.url
  );
}
