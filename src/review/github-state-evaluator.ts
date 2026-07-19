import type { Proposal } from "../domain/types.js";
import type {
  GitHubCheckRun,
  GitHubPullRequestState
} from "../integrations/github/github-types.js";

export type PullRequestGateFindingSeverity = "block" | "request_changes";

export interface PullRequestGateFinding {
  id: string;
  severity: PullRequestGateFindingSeverity;
  message: string;
}

export interface GitHubStateEvaluationInput {
  proposal: Proposal;
  prState: GitHubPullRequestState;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
  requireApprovedReview?: boolean;
}

export function evaluateGitHubPullRequestState(
  input: GitHubStateEvaluationInput
): PullRequestGateFinding[] {
  const findings: PullRequestGateFinding[] = [];
  const requiredCheckNames = input.requiredCheckNames ?? [];
  const requireApprovedReview = input.requireApprovedReview ?? true;

  findings.push(...evaluateRequiredChecks(input.prState.checks, requiredCheckNames));

  if (requireApprovedReview && !hasApprovedReview(input.prState)) {
    findings.push({
      id: "missing-approved-review",
      severity: "block",
      message: "Required approving review is missing."
    });
  }

  findings.push(
    ...input.prState.unresolvedThreads.map((thread) => ({
      id: "unresolved-review-thread",
      severity: "block" as const,
      message: `Unresolved review thread remains: ${thread.id} in ${thread.path}.`
    }))
  );

  if (!input.prState.mergeability.canMerge) {
    findings.push({
      id: "mergeability-not-ready",
      severity: "block",
      message: `PR is not mergeable: ${input.prState.mergeability.reason ?? input.prState.mergeability.state}.`
    });
  }

  if (
    input.expectedHeadSha &&
    input.expectedHeadSha !== input.prState.headSha
  ) {
    findings.push({
      id: "head-sha-mismatch",
      severity: "block",
      message: `PR head SHA changed from ${input.expectedHeadSha} to ${input.prState.headSha}.`
    });
  }

  const expectedFiles = input.proposal.filesExpectedToChange.map(normalizePath);
  for (const changedFile of input.prState.changedFiles.map(normalizePath)) {
    if (!matchesExpectedFile(changedFile, expectedFiles)) {
      findings.push({
        id: "unexpected-pr-file",
        severity: "block",
        message: `PR changed file outside proposal scope: ${changedFile}.`
      });
    }
  }

  return findings;
}

function evaluateRequiredChecks(
  checks: GitHubCheckRun[],
  requiredCheckNames: string[]
): PullRequestGateFinding[] {
  return requiredCheckNames.flatMap((requiredCheckName) => {
    const check = checks.find((candidate) => candidate.name === requiredCheckName);

    if (!check) {
      return [
        {
          id: "missing-required-check",
          severity: "block" as const,
          message: `Required check is missing: ${requiredCheckName}.`
        }
      ];
    }

    if (check.status !== "completed") {
      return [
        {
          id: "pending-required-check",
          severity: "block" as const,
          message: `Required check is still running: ${requiredCheckName}.`
        }
      ];
    }

    if (check.conclusion !== "success") {
      return [
        {
          id: "failed-required-check",
          severity: "block" as const,
          message: `Required check failed: ${requiredCheckName}.`
        }
      ];
    }

    return [];
  });
}

function hasApprovedReview(prState: GitHubPullRequestState): boolean {
  return prState.reviews.some((review) => review.state === "approved");
}

function matchesExpectedFile(path: string, expectedFiles: string[]): boolean {
  return expectedFiles.some((expectedPath) => {
    if (expectedPath.endsWith("/")) {
      return path.startsWith(expectedPath);
    }

    return path === expectedPath;
  });
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}
