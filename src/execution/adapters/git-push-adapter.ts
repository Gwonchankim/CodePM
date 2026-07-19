import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import type { AuditEntry } from "../../domain/types.js";
import { readGitState } from "../../integrations/git/git-reader.js";
import type { GitState } from "../../integrations/git/git-types.js";
import {
  realGitPushRunner,
  type GitCommandResult,
  type GitHeadResult,
  type GitPushRunner
} from "../../integrations/git/git-writer.js";
import type { ApprovalEvidence } from "../../policy/approval-evidence.js";
import { scanSecrets } from "../../policy/secret-scanner.js";
import type { ExecutionPreflightResult } from "../execution-preflight.js";

export type GitPushFindingCode =
  | "preflight_blocked"
  | "missing_remote"
  | "missing_branch"
  | "force_push_not_approved"
  | "git_state_unavailable"
  | "secret_findings"
  | "git_push_failed"
  | "head_read_failed";

export interface GitPushFinding {
  code: GitPushFindingCode;
  message: string;
}

export interface ExecuteGitPushInput {
  cwd: string;
  remote: string;
  branch: string;
  preflight: ExecutionPreflightResult;
  force?: boolean;
  approval?: ApprovalEvidence;
  gitState?: GitState;
  secretScanBaseRef?: string;
  runner?: GitPushRunner;
  auditLogPath?: string;
  now?: string;
}

export type GitPushExecutionResult =
  | {
      ok: true;
      status: "pushed";
      findings: [];
      command: string[];
      stdout: string;
      stderr: string;
      finalHeadSha: string;
      auditEntry: AuditEntry;
    }
  | {
      ok: false;
      status: "blocked" | "failed";
      findings: GitPushFinding[];
      command: string[] | undefined;
      stdout: string;
      stderr: string;
      finalHeadSha: string | undefined;
      auditEntry: AuditEntry;
    };

export type { GitPushRunner } from "../../integrations/git/git-writer.js";

export function executeGitPush(
  input: ExecuteGitPushInput
): GitPushExecutionResult {
  const runner = input.runner ?? realGitPushRunner;
  const preCommandFindings = collectPreCommandFindings(input);

  if (preCommandFindings.length > 0) {
    const auditEntry = createPushAuditEntry({
      input,
      decision: "block",
      reason: `Git push blocked for ${input.remote} ${input.branch}.`,
      result: "blocked",
      command: undefined,
      finalHeadSha: undefined,
      findings: preCommandFindings
    });
    appendAuditIfRequested(input.auditLogPath, auditEntry);

    return {
      ok: false,
      status: "blocked",
      findings: preCommandFindings,
      command: undefined,
      stdout: "",
      stderr: "",
      finalHeadSha: undefined,
      auditEntry
    };
  }

  const pushResult = runner.pushBranch({
    cwd: input.cwd,
    remote: input.remote,
    branch: input.branch,
    force: input.force
  });
  const headResult = runner.readHeadSha(input.cwd);

  if (!pushResult.ok || !headResult.ok) {
    return toFailedResult(input, pushResult, headResult);
  }

  const auditEntry = createPushAuditEntry({
    input,
    decision: "approve",
    reason: `Git push succeeded for ${input.remote} ${input.branch}.`,
    result: "success",
    command: pushResult.command,
    finalHeadSha: headResult.headSha,
    findings: []
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: true,
    status: "pushed",
    findings: [],
    command: pushResult.command,
    stdout: pushResult.stdout,
    stderr: pushResult.stderr,
    finalHeadSha: headResult.headSha,
    auditEntry
  };
}

function collectPreCommandFindings(input: ExecuteGitPushInput): GitPushFinding[] {
  const findings: GitPushFinding[] = [];

  if (!input.preflight.ok) {
    findings.push({
      code: "preflight_blocked",
      message: "Git push requires an allowed execution preflight result."
    });
  }

  if (input.remote.trim().length === 0) {
    findings.push({
      code: "missing_remote",
      message: "Git push requires an explicit remote target."
    });
  }

  if (input.branch.trim().length === 0) {
    findings.push({
      code: "missing_branch",
      message: "Git push requires an explicit branch target."
    });
  }

  if (input.force && !hasExactForcePushApproval(input)) {
    findings.push({
      code: "force_push_not_approved",
      message:
        "Force push requires approval scoped to push_branch, remote, branch, and forcePush."
    });
  }

  const gitState = input.gitState ?? readCurrentGitState(input);

  if (!gitState) {
    findings.push({
      code: "git_state_unavailable",
      message: "Git state could not be read before push."
    });
    return findings;
  }

  const secretScan = scanSecrets({
    text: gitState.diffText,
    paths: gitState.changedFiles
  });

  if (!secretScan.ok) {
    findings.push({
      code: "secret_findings",
      message: `Secret scan blocked push: ${secretScan.findings.map((finding) => finding.message).join(" ")}`
    });
  }

  return findings;
}

function readCurrentGitState(input: ExecuteGitPushInput): GitState | undefined {
  const result = readGitState({
    cwd: input.cwd,
    baseRef: input.secretScanBaseRef
  });

  return result.ok ? result.state : undefined;
}

function hasExactForcePushApproval(input: ExecuteGitPushInput): boolean {
  return (
    input.approval?.requestedAction === "push_branch" &&
    input.approval.scope.remote === input.remote &&
    input.approval.scope.branch === input.branch &&
    input.approval.scope.forcePush === true
  );
}

function toFailedResult(
  input: ExecuteGitPushInput,
  pushResult: GitCommandResult,
  headResult: GitHeadResult | GitCommandResult
): GitPushExecutionResult {
  const findings: GitPushFinding[] = [];

  if (!pushResult.ok) {
    findings.push({
      code: "git_push_failed",
      message: pushResult.message
    });
  }

  if (!headResult.ok) {
    findings.push({
      code: "head_read_failed",
      message: headResult.message
    });
  }

  const auditEntry = createPushAuditEntry({
    input,
    decision: "block",
    reason: `Git push failed for ${input.remote} ${input.branch}.`,
    result: "failure",
    command: pushResult.command,
    finalHeadSha: undefined,
    findings
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: false,
    status: "failed",
    findings,
    command: pushResult.command,
    stdout: pushResult.stdout,
    stderr: pushResult.stderr,
    finalHeadSha: undefined,
    auditEntry
  };
}

function createPushAuditEntry(input: {
  input: ExecuteGitPushInput;
  decision: AuditEntry["decision"];
  reason: string;
  result: "success" | "blocked" | "failure";
  command: string[] | undefined;
  finalHeadSha: string | undefined;
  findings: GitPushFinding[];
}): AuditEntry {
  return createAuditEntry({
    timestamp: input.input.now ?? new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: "push_branch",
    decision: input.decision,
    reason: input.reason,
    filesChanged: input.input.gitState?.changedFiles ?? [],
    riskLevel: input.input.preflight.afterAuditEntry.riskLevel,
    testEvidence: input.input.preflight.afterAuditEntry.testEvidence,
    github: {
      remote: input.input.remote,
      branch: input.input.branch,
      command: input.command?.join(" ") ?? null,
      result: input.result,
      finalHeadSha: input.finalHeadSha ?? null,
      findings: input.findings.map((finding) => finding.message)
    },
    humanApprovalRequired: input.input.preflight.approvalRequired,
    humanApprovalGranted:
      input.input.preflight.afterAuditEntry.humanApprovalGranted
  });
}

function appendAuditIfRequested(
  auditLogPath: string | undefined,
  auditEntry: AuditEntry
): void {
  if (!auditLogPath) {
    return;
  }

  appendAuditEntry(auditLogPath, auditEntry);
}
