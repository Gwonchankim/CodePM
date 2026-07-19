import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import type { AuditEntry, Proposal } from "../../domain/types.js";
import type {
  GitHubCreatePullRequestInput,
  GitHubMergePullRequestInput,
  GitHubMutationAdapter,
  GitHubMutationResult,
  GitHubMutationSuccess
} from "../../integrations/github/github-mutation-port.js";
import type { GitHubRestMutationAdapter } from "../../integrations/github/github-rest-mutation-adapter.js";
import type { GitHubPullRequestState } from "../../integrations/github/github-types.js";
import { reviewPullRequestGate } from "../../review/pr-gate-reviewer.js";
import type { ExecutionPreflightResult } from "../execution-preflight.js";

export type GitHubPrExecutionFindingCode =
  | "preflight_blocked"
  | "action_mismatch"
  | "missing_base_ref"
  | "missing_head_ref"
  | "metadata_invalid"
  | "pr_gate_blocked"
  | "mutation_failed";

export interface GitHubPrExecutionFinding {
  code: GitHubPrExecutionFindingCode;
  message: string;
}

export interface ExecuteGitHubCreatePullRequestInput
  extends GitHubCreatePullRequestInput {
  adapter: GitHubMutationAdapter;
  preflight: ExecutionPreflightResult;
  proposal: Proposal;
  auditLogPath?: string;
  now?: string;
}

export interface ExecuteGitHubCreatePullRequestAsyncInput
  extends Omit<ExecuteGitHubCreatePullRequestInput, "adapter"> {
  adapter: GitHubRestMutationAdapter;
}

export interface ExecuteGitHubMergePullRequestInput {
  adapter: GitHubMutationAdapter;
  preflight: ExecutionPreflightResult;
  proposal: Proposal;
  prState: GitHubPullRequestState;
  expectedHeadSha: string;
  requiredCheckNames?: string[];
  requireApprovedReview?: boolean;
  mergeMethod?: GitHubMergePullRequestInput["mergeMethod"];
  auditLogPath?: string;
  now?: string;
}

export interface ExecuteGitHubMergePullRequestAsyncInput
  extends Omit<ExecuteGitHubMergePullRequestInput, "adapter"> {
  adapter: GitHubRestMutationAdapter;
}

export type GitHubPrExecutionResult =
  | {
      ok: true;
      status: "created" | "merged";
      findings: [];
      url: string;
      mutation: GitHubMutationSuccess;
      auditEntry: AuditEntry;
    }
  | {
      ok: false;
      status: "blocked" | "failed";
      findings: GitHubPrExecutionFinding[];
      url?: string;
      mutation?: GitHubMutationResult;
      auditEntry: AuditEntry;
    };

export function executeGitHubCreatePullRequest(
  input: ExecuteGitHubCreatePullRequestInput
): GitHubPrExecutionResult {
  const findings = collectCreateFindings(input);

  if (findings.length > 0) {
    return blockGitHubAction({
      action: "create_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR creation blocked for ${input.repo}.`,
      findings,
      auditLogPath: input.auditLogPath,
      now: input.now,
      github: {
        repo: input.repo,
        baseRef: input.baseRef,
        headRef: input.headRef,
        expectedHeadSha: input.expectedHeadSha ?? null,
        result: "blocked"
      }
    });
  }

  const mutation = input.adapter.createPullRequest({
    repo: input.repo,
    baseRef: input.baseRef,
    headRef: input.headRef,
    title: input.title,
    body: input.body,
    expectedHeadSha: input.expectedHeadSha,
    draft: input.draft
  });

  if (!mutation.ok) {
    return failGitHubAction({
      action: "create_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR creation failed for ${input.repo}.`,
      mutation,
      auditLogPath: input.auditLogPath,
      now: input.now,
      github: {
        repo: input.repo,
        baseRef: input.baseRef,
        headRef: input.headRef,
        expectedHeadSha: input.expectedHeadSha ?? null,
        result: "failure",
        failureCode: mutation.code
      }
    });
  }

  const auditEntry = createGitHubActionAuditEntry({
    action: "create_pr",
    proposal: input.proposal,
    preflight: input.preflight,
    decision: "approve",
    reason: `GitHub PR creation succeeded for ${input.repo}.`,
    now: input.now,
    github: {
      repo: mutation.repo,
      prNumber: mutation.prNumber,
      baseRef: input.baseRef,
      headRef: input.headRef,
      expectedHeadSha: input.expectedHeadSha ?? null,
      url: mutation.url,
      result: mutation.result,
      stateReadAt: mutation.stateReadAt,
      headSha: mutation.headSha ?? null
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: true,
    status: "created",
    findings: [],
    url: mutation.url,
    mutation,
    auditEntry
  };
}

export async function executeGitHubCreatePullRequestAsync(
  input: ExecuteGitHubCreatePullRequestAsyncInput
): Promise<GitHubPrExecutionResult> {
  const findings = collectCreateFindings(input);

  if (findings.length > 0) {
    return blockGitHubAction({
      action: "create_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR creation blocked for ${input.repo}.`,
      findings,
      auditLogPath: input.auditLogPath,
      now: input.now,
      github: {
        repo: input.repo,
        baseRef: input.baseRef,
        headRef: input.headRef,
        expectedHeadSha: input.expectedHeadSha ?? null,
        result: "blocked"
      }
    });
  }

  const mutation = await input.adapter.createPullRequest({
    repo: input.repo,
    baseRef: input.baseRef,
    headRef: input.headRef,
    title: input.title,
    body: input.body,
    expectedHeadSha: input.expectedHeadSha,
    draft: input.draft
  });

  if (!mutation.ok) {
    return failGitHubAction({
      action: "create_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR creation failed for ${input.repo}.`,
      mutation,
      auditLogPath: input.auditLogPath,
      now: input.now,
      github: {
        repo: input.repo,
        baseRef: input.baseRef,
        headRef: input.headRef,
        expectedHeadSha: input.expectedHeadSha ?? null,
        result: "failure",
        failureCode: mutation.code
      }
    });
  }

  const auditEntry = createGitHubActionAuditEntry({
    action: "create_pr",
    proposal: input.proposal,
    preflight: input.preflight,
    decision: "approve",
    reason: `GitHub PR creation succeeded for ${input.repo}.`,
    now: input.now,
    github: {
      repo: mutation.repo,
      prNumber: mutation.prNumber,
      baseRef: input.baseRef,
      headRef: input.headRef,
      expectedHeadSha: input.expectedHeadSha ?? null,
      url: mutation.url,
      result: mutation.result,
      stateReadAt: mutation.stateReadAt,
      headSha: mutation.headSha ?? null
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: true,
    status: "created",
    findings: [],
    url: mutation.url,
    mutation,
    auditEntry
  };
}

export function executeGitHubMergePullRequest(
  input: ExecuteGitHubMergePullRequestInput
): GitHubPrExecutionResult {
  const findings = collectMergeFindings(input);

  if (findings.length > 0) {
    return blockGitHubAction({
      action: "merge_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR merge blocked for ${input.prState.repo}#${input.prState.prNumber}.`,
      findings,
      auditLogPath: input.auditLogPath,
      now: input.now,
      filesChanged: input.prState.changedFiles,
      github: {
        repo: input.prState.repo,
        prNumber: input.prState.prNumber,
        expectedHeadSha: input.expectedHeadSha,
        headSha: input.prState.headSha,
        prStateReadAt: input.prState.readAt,
        result: "blocked"
      }
    });
  }

  const mutation = input.adapter.mergePullRequest({
    repo: input.prState.repo,
    prNumber: input.prState.prNumber,
    expectedHeadSha: input.expectedHeadSha,
    mergeMethod: input.mergeMethod
  });

  if (!mutation.ok) {
    return failGitHubAction({
      action: "merge_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR merge failed for ${input.prState.repo}#${input.prState.prNumber}.`,
      mutation,
      auditLogPath: input.auditLogPath,
      now: input.now,
      filesChanged: input.prState.changedFiles,
      github: {
        repo: input.prState.repo,
        prNumber: input.prState.prNumber,
        expectedHeadSha: input.expectedHeadSha,
        headSha: input.prState.headSha,
        prStateReadAt: input.prState.readAt,
        result: "failure",
        failureCode: mutation.code
      }
    });
  }

  const auditEntry = createGitHubActionAuditEntry({
    action: "merge_pr",
    proposal: input.proposal,
    preflight: input.preflight,
    decision: "approve",
    reason: `GitHub PR merge succeeded for ${input.prState.repo}#${input.prState.prNumber}.`,
    now: input.now,
    filesChanged: input.prState.changedFiles,
    github: {
      repo: mutation.repo,
      prNumber: mutation.prNumber,
      expectedHeadSha: input.expectedHeadSha,
      headSha: mutation.headSha ?? input.prState.headSha,
      url: mutation.url,
      result: mutation.result,
      stateReadAt: mutation.stateReadAt,
      prStateReadAt: input.prState.readAt,
      mergeSha: mutation.mergeSha ?? null
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: true,
    status: "merged",
    findings: [],
    url: mutation.url,
    mutation,
    auditEntry
  };
}

export async function executeGitHubMergePullRequestAsync(
  input: ExecuteGitHubMergePullRequestAsyncInput
): Promise<GitHubPrExecutionResult> {
  const findings = collectMergeFindings(input);

  if (findings.length > 0) {
    return blockGitHubAction({
      action: "merge_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR merge blocked for ${input.prState.repo}#${input.prState.prNumber}.`,
      findings,
      auditLogPath: input.auditLogPath,
      now: input.now,
      filesChanged: input.prState.changedFiles,
      github: {
        repo: input.prState.repo,
        prNumber: input.prState.prNumber,
        expectedHeadSha: input.expectedHeadSha,
        headSha: input.prState.headSha,
        prStateReadAt: input.prState.readAt,
        result: "blocked"
      }
    });
  }

  const mutation = await input.adapter.mergePullRequest({
    repo: input.prState.repo,
    prNumber: input.prState.prNumber,
    expectedHeadSha: input.expectedHeadSha,
    mergeMethod: input.mergeMethod
  });

  if (!mutation.ok) {
    return failGitHubAction({
      action: "merge_pr",
      proposal: input.proposal,
      preflight: input.preflight,
      reason: `GitHub PR merge failed for ${input.prState.repo}#${input.prState.prNumber}.`,
      mutation,
      auditLogPath: input.auditLogPath,
      now: input.now,
      filesChanged: input.prState.changedFiles,
      github: {
        repo: input.prState.repo,
        prNumber: input.prState.prNumber,
        expectedHeadSha: input.expectedHeadSha,
        headSha: input.prState.headSha,
        prStateReadAt: input.prState.readAt,
        result: "failure",
        failureCode: mutation.code
      }
    });
  }

  const auditEntry = createGitHubActionAuditEntry({
    action: "merge_pr",
    proposal: input.proposal,
    preflight: input.preflight,
    decision: "approve",
    reason: `GitHub PR merge succeeded for ${input.prState.repo}#${input.prState.prNumber}.`,
    now: input.now,
    filesChanged: input.prState.changedFiles,
    github: {
      repo: mutation.repo,
      prNumber: mutation.prNumber,
      expectedHeadSha: input.expectedHeadSha,
      headSha: mutation.headSha ?? input.prState.headSha,
      url: mutation.url,
      result: mutation.result,
      stateReadAt: mutation.stateReadAt,
      prStateReadAt: input.prState.readAt,
      mergeSha: mutation.mergeSha ?? null
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: true,
    status: "merged",
    findings: [],
    url: mutation.url,
    mutation,
    auditEntry
  };
}

function collectCreateFindings(
  input: Omit<ExecuteGitHubCreatePullRequestInput, "adapter">
): GitHubPrExecutionFinding[] {
  const findings = collectPreflightFindings(input.preflight);

  if (input.proposal.requestedAction !== "create_pr") {
    findings.push({
      code: "action_mismatch",
      message: `Proposal requested ${input.proposal.requestedAction}, not create_pr.`
    });
  }

  if (input.baseRef.trim().length === 0) {
    findings.push({
      code: "missing_base_ref",
      message: "PR creation requires an explicit base branch."
    });
  }

  if (input.headRef.trim().length === 0) {
    findings.push({
      code: "missing_head_ref",
      message: "PR creation requires an explicit head branch."
    });
  }

  if (input.title.trim().length === 0) {
    findings.push({
      code: "metadata_invalid",
      message: "PR creation requires a non-empty title."
    });
  }

  const body = input.body.toLowerCase();
  if (
    input.body.trim().length === 0 ||
    !body.includes(input.proposal.testPlan.toLowerCase())
  ) {
    findings.push({
      code: "metadata_invalid",
      message: "PR body must include the approved test plan."
    });
  }

  if (
    input.body.trim().length === 0 ||
    !body.includes(input.proposal.rollbackPlan.toLowerCase())
  ) {
    findings.push({
      code: "metadata_invalid",
      message: "PR body must include the approved rollback plan."
    });
  }

  return findings;
}

function collectMergeFindings(
  input: Omit<ExecuteGitHubMergePullRequestInput, "adapter">
): GitHubPrExecutionFinding[] {
  const findings = collectPreflightFindings(input.preflight);

  if (input.proposal.requestedAction !== "merge_pr") {
    findings.push({
      code: "action_mismatch",
      message: `Proposal requested ${input.proposal.requestedAction}, not merge_pr.`
    });
  }

  const gateDecision = reviewPullRequestGate({
    proposal: input.proposal,
    prState: input.prState,
    expectedHeadSha: input.expectedHeadSha,
    requiredCheckNames: input.requiredCheckNames,
    requireApprovedReview: input.requireApprovedReview
  });

  if (gateDecision.decision !== "approve") {
    findings.push(
      ...[
        ...gateDecision.requiredChanges,
        ...gateDecision.risks
      ].map((message) => ({
        code: "pr_gate_blocked" as const,
        message
      }))
    );
  }

  return findings;
}

function collectPreflightFindings(
  preflight: ExecutionPreflightResult
): GitHubPrExecutionFinding[] {
  if (preflight.ok) {
    return [];
  }

  return [
    {
      code: "preflight_blocked",
      message: "GitHub mutation requires an allowed execution preflight result."
    },
    ...preflight.findings.map((finding) => ({
      code: "preflight_blocked" as const,
      message: finding.message
    }))
  ];
}

function blockGitHubAction(input: {
  action: "create_pr" | "merge_pr";
  proposal: Proposal;
  preflight: ExecutionPreflightResult;
  reason: string;
  findings: GitHubPrExecutionFinding[];
  github: Record<string, unknown>;
  auditLogPath?: string;
  now?: string;
  filesChanged?: string[];
}): GitHubPrExecutionResult {
  const auditEntry = createGitHubActionAuditEntry({
    ...input,
    decision: "block",
    github: {
      ...input.github,
      findings: input.findings.map((finding) => finding.message)
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: false,
    status: "blocked",
    findings: input.findings,
    auditEntry
  };
}

function failGitHubAction(input: {
  action: "create_pr" | "merge_pr";
  proposal: Proposal;
  preflight: ExecutionPreflightResult;
  reason: string;
  mutation: GitHubMutationResult;
  github: Record<string, unknown>;
  auditLogPath?: string;
  now?: string;
  filesChanged?: string[];
}): GitHubPrExecutionResult {
  const finding = {
    code: "mutation_failed" as const,
    message: input.mutation.ok
      ? "GitHub mutation failed."
      : input.mutation.message
  };
  const auditEntry = createGitHubActionAuditEntry({
    ...input,
    decision: "block",
    github: {
      ...input.github,
      findings: [finding.message]
    }
  });
  appendAuditIfRequested(input.auditLogPath, auditEntry);

  return {
    ok: false,
    status: "failed",
    findings: [finding],
    mutation: input.mutation,
    auditEntry
  };
}

function createGitHubActionAuditEntry(input: {
  action: "create_pr" | "merge_pr";
  proposal: Proposal;
  preflight: ExecutionPreflightResult;
  decision: AuditEntry["decision"];
  reason: string;
  github: Record<string, unknown>;
  now?: string;
  filesChanged?: string[];
}): AuditEntry {
  return createAuditEntry({
    timestamp: input.now ?? new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: input.action,
    decision: input.decision,
    reason: input.reason,
    filesChanged: input.filesChanged ?? input.proposal.filesExpectedToChange,
    riskLevel: input.preflight.afterAuditEntry.riskLevel,
    testEvidence: input.proposal.testPlan,
    github: input.github,
    humanApprovalRequired: input.preflight.approvalRequired,
    humanApprovalGranted: input.preflight.afterAuditEntry.humanApprovalGranted
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
