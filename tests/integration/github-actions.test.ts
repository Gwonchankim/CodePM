import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Decision, Proposal } from "../../src/domain/types.js";
import type { GitHubPullRequestState } from "../../src/integrations/github/github-types.js";
import type { GitHubMutationAdapter } from "../../src/integrations/github/github-mutation-port.js";
import type { ApprovalEvidence } from "../../src/policy/approval-evidence.js";
import { runExecutionPreflight } from "../../src/execution/execution-preflight.js";
import {
  executeGitHubCreatePullRequest,
  executeGitHubMergePullRequest
} from "../../src/execution/adapters/github-pr-adapter.js";

const decision: Decision = {
  decision: "approve",
  summary: "GitHub action approved.",
  requiredChanges: [],
  risks: [],
  verificationRequired: ["Re-check state."],
  approvedActions: ["Proceed to execution preflight."],
  blockedActions: ["Do not execute if state changes."]
};

function proposal(action: "create_pr" | "merge_pr"): Proposal {
  return {
    goal: "Add CodePM GitHub mutation adapters",
    context: "CodePM needs guarded GitHub PR mutations.",
    proposedChanges: "Create or merge a PR only after PM preflight.",
    filesExpectedToChange: [
      "src/integrations/github/github-types.ts",
      "src/integrations/github/github-port.ts"
    ],
    riskAssessment: { level: "medium", areas: ["GitHub mutation"] },
    testPlan: "npm test -- --run tests/integration/github-actions",
    commandsToRun: ["npm test -- --run tests/integration/github-actions"],
    requestedAction: action,
    rollbackPlan: "Close or revert the PR.",
    openQuestions: []
  };
}

function readGithubFixture(): GitHubPullRequestState {
  return JSON.parse(
    readFileSync("tests/fixtures/github/passing-pr.json", "utf8")
  ) as GitHubPullRequestState;
}

function readApprovalFixture(): ApprovalEvidence {
  return JSON.parse(
    readFileSync("tests/fixtures/approvals/merge-pr-approval.json", "utf8")
  ) as ApprovalEvidence;
}

function fakeAdapter(): GitHubMutationAdapter {
  return {
    createPullRequest(input) {
      return {
        ok: true,
        action: "create_pr",
        repo: input.repo,
        prNumber: 101,
        url: "https://github.com/octo/example/pull/101",
        result: "created",
        headSha: input.expectedHeadSha,
        stateReadAt: "2026-05-25T00:31:00.000Z"
      };
    },
    mergePullRequest(input) {
      return {
        ok: true,
        action: "merge_pr",
        repo: input.repo,
        prNumber: input.prNumber,
        url: "https://github.com/octo/example/pull/42",
        result: "merged",
        headSha: input.expectedHeadSha,
        stateReadAt: "2026-05-25T00:31:00.000Z",
        mergeSha: "merge-sha-456"
      };
    }
  };
}

describe("mocked GitHub PR action execution", () => {
  it("creates and merges through the mutation port after guarded preflight", () => {
    const createProposal = proposal("create_pr");
    const createScope = {
      repo: "octo/example",
      branch: "feature/github-read-model",
      expectedHeadSha: "abc123passing",
      filesChanged: createProposal.filesExpectedToChange
    };
    const createPreflight = runExecutionPreflight({
      decision,
      approvedAction: "create_pr",
      requestedAction: "create_pr",
      riskLevel: "low",
      reviewedScope: createScope,
      currentScope: createScope,
      now: "2026-05-25T00:30:00.000Z"
    });
    const body = [
      createProposal.proposedChanges,
      createProposal.testPlan,
      createProposal.rollbackPlan
    ].join("\n\n");

    const createResult = executeGitHubCreatePullRequest({
      adapter: fakeAdapter(),
      preflight: createPreflight,
      proposal: createProposal,
      repo: "octo/example",
      baseRef: "main",
      headRef: "feature/github-read-model",
      expectedHeadSha: "abc123passing",
      title: createProposal.goal,
      body
    });

    const mergeProposal = proposal("merge_pr");
    const mergeScope = {
      repo: "octo/example",
      branch: "feature/github-read-model",
      prNumber: 42,
      expectedHeadSha: "abc123passing",
      filesChanged: mergeProposal.filesExpectedToChange
    };
    const mergePreflight = runExecutionPreflight({
      decision,
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "medium",
      reviewedScope: mergeScope,
      currentScope: mergeScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    const mergeResult = executeGitHubMergePullRequest({
      adapter: fakeAdapter(),
      preflight: mergePreflight,
      proposal: mergeProposal,
      prState: readGithubFixture(),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(createResult.ok).toBe(true);
    expect(createResult.url).toBe("https://github.com/octo/example/pull/101");
    expect(mergeResult.ok).toBe(true);
    expect(mergeResult.url).toBe("https://github.com/octo/example/pull/42");
  });
});
