import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Proposal } from "../../../src/domain/types.js";
import type { GitHubPullRequestState } from "../../../src/integrations/github/github-types.js";
import { evaluateGitHubPullRequestState } from "../../../src/review/github-state-evaluator.js";
import { reviewPullRequestGate } from "../../../src/review/pr-gate-reviewer.js";

function readGithubFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readFileSync(`tests/fixtures/github/${name}.json`, "utf8")
  ) as GitHubPullRequestState;
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    goal: "Add CodePM GitHub read model",
    context: "CodePM needs to determine whether a GitHub PR is merge-ready.",
    proposedChanges: "Define the read-only PR state contract.",
    filesExpectedToChange: [
      "src/integrations/github/github-types.ts",
      "src/integrations/github/github-port.ts"
    ],
    riskAssessment: {
      level: "medium",
      areas: ["local tooling"]
    },
    testPlan: "npm test -- --run tests/unit/integrations/github",
    commandsToRun: ["npm test -- --run tests/unit/integrations/github"],
    requestedAction: "merge_pr",
    rollbackPlan: "Revert the GitHub read model files.",
    openQuestions: [],
    ...overrides
  };
}

function cloneState(
  state: GitHubPullRequestState,
  overrides: Partial<GitHubPullRequestState> = {}
): GitHubPullRequestState {
  return {
    ...state,
    checks: [...state.checks],
    reviews: [...state.reviews],
    reviewThreads: [...state.reviewThreads],
    unresolvedThreads: [...state.unresolvedThreads],
    mergeability: { ...state.mergeability },
    changedFiles: [...state.changedFiles],
    ...overrides
  };
}

describe("evaluateGitHubPullRequestState", () => {
  it("reports CI, review, thread, mergeability, head SHA, and scope findings", () => {
    const findings = evaluateGitHubPullRequestState({
      proposal: makeProposal(),
      prState: cloneState(readGithubFixture("passing-pr"), {
        headSha: "new-head",
        checks: [],
        reviews: [],
        unresolvedThreads: [
          {
            id: "thread-1",
            path: "src/review/pr-gate-reviewer.ts",
            line: 12,
            isResolved: false,
            summary: "Needs fix"
          }
        ],
        mergeability: {
          state: "unknown",
          isDraft: false,
          canMerge: false,
          reason: "Required check state is missing."
        },
        changedFiles: ["src/unexpected.ts"]
      }),
      expectedHeadSha: "old-head",
      requiredCheckNames: ["test"],
      requireApprovedReview: true
    });

    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "missing-required-check",
        "missing-approved-review",
        "unresolved-review-thread",
        "mergeability-not-ready",
        "head-sha-mismatch",
        "unexpected-pr-file"
      ])
    );
  });
});

describe("reviewPullRequestGate", () => {
  it("approves a merge-ready PR when checks, reviews, head SHA, and scope match", () => {
    const decision = reviewPullRequestGate({
      proposal: makeProposal(),
      prState: readGithubFixture("passing-pr"),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(decision.decision).toBe("approve");
    expect(decision.summary).toContain("merge-ready");
    expect(decision.approvedActions).toContain(
      "Proceed to execution preflight for merge_pr."
    );
    expect(decision.blockedActions).toContain(
      "Do not merge if the PR head SHA changes before execution."
    );
  });

  it("blocks merge when CI failed", () => {
    const decision = reviewPullRequestGate({
      proposal: makeProposal({
        filesExpectedToChange: ["src/review/pr-gate-reviewer.ts"]
      }),
      prState: readGithubFixture("failing-pr"),
      expectedHeadSha: "abc123failing",
      requiredCheckNames: ["test"]
    });

    expect(decision.decision).toBe("block");
    expect(decision.risks).toContain("Required check failed: test.");
    expect(decision.blockedActions).toContain("Do not merge the PR.");
  });

  it("blocks merge when CI is pending or required checks are missing", () => {
    const pendingDecision = reviewPullRequestGate({
      proposal: makeProposal({
        filesExpectedToChange: ["src/review/pr-gate-reviewer.ts"]
      }),
      prState: readGithubFixture("pending-pr"),
      expectedHeadSha: "abc123pending",
      requiredCheckNames: ["test"]
    });
    const missingDecision = reviewPullRequestGate({
      proposal: makeProposal(),
      prState: readGithubFixture("passing-pr"),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test", "typecheck"]
    });

    expect(pendingDecision.decision).toBe("block");
    expect(pendingDecision.risks).toContain("Required check is still running: test.");
    expect(missingDecision.decision).toBe("block");
    expect(missingDecision.risks).toContain("Required check is missing: typecheck.");
  });

  it("blocks merge when reviews are missing or review threads are unresolved", () => {
    const missingReviewDecision = reviewPullRequestGate({
      proposal: makeProposal(),
      prState: cloneState(readGithubFixture("passing-pr"), { reviews: [] }),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });
    const unresolvedDecision = reviewPullRequestGate({
      proposal: makeProposal({
        filesExpectedToChange: ["src/review/pr-gate-reviewer.ts"]
      }),
      prState: readGithubFixture("unresolved-thread-pr"),
      expectedHeadSha: "abc123thread",
      requiredCheckNames: ["test"]
    });

    expect(missingReviewDecision.decision).toBe("block");
    expect(missingReviewDecision.risks).toContain(
      "Required approving review is missing."
    );
    expect(unresolvedDecision.decision).toBe("block");
    expect(unresolvedDecision.risks).toContain(
      "Unresolved review thread remains: thread-1 in src/review/pr-gate-reviewer.ts."
    );
  });

  it("blocks merge when the head SHA is stale or the PR diff is outside scope", () => {
    const decision = reviewPullRequestGate({
      proposal: makeProposal(),
      prState: cloneState(readGithubFixture("passing-pr"), {
        headSha: "new-head",
        changedFiles: ["src/unexpected.ts"]
      }),
      expectedHeadSha: "old-head",
      requiredCheckNames: ["test"]
    });

    expect(decision.decision).toBe("block");
    expect(decision.risks).toContain(
      "PR head SHA changed from old-head to new-head."
    );
    expect(decision.risks).toContain(
      "PR changed file outside proposal scope: src/unexpected.ts."
    );
  });

  it("requests changes for PR creation metadata that does not match the proposal", () => {
    const decision = reviewPullRequestGate({
      proposal: makeProposal({
        requestedAction: "create_pr"
      }),
      prState: cloneState(readGithubFixture("passing-pr"), {
        title: "",
        body: ""
      }),
      requiredCheckNames: []
    });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain(
      "Add a PR title that describes the proposal goal."
    );
    expect(decision.requiredChanges).toContain(
      "Add a PR body that includes the test plan and rollback plan."
    );
  });

  it("approves PR creation metadata without requiring post-creation checks or reviews", () => {
    const proposal = makeProposal({
      requestedAction: "create_pr"
    });
    const decision = reviewPullRequestGate({
      proposal,
      prState: cloneState(readGithubFixture("pending-pr"), {
        title: proposal.goal,
        body: [
          proposal.proposedChanges,
          proposal.testPlan,
          proposal.rollbackPlan
        ].join("\n\n"),
        reviews: [],
        checks: [],
        mergeability: {
          state: "unknown",
          isDraft: false,
          canMerge: false,
          reason: "PR has not been created yet."
        }
      }),
      requiredCheckNames: ["test"]
    });

    expect(decision.decision).toBe("approve");
    expect(decision.approvedActions).toContain(
      "Proceed to execution preflight for create_pr."
    );
  });
});
