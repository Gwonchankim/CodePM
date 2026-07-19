import { describe, expect, it } from "vitest";

import type { Proposal } from "../../../src/domain/types.js";
import type { GitState } from "../../../src/integrations/git/git-types.js";
import { reviewDiff } from "../../../src/review/diff-reviewer.js";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    goal: "Add local git diff review",
    context: "CodePM needs to compare implementation evidence against the plan.",
    proposedChanges: "Add the diff reviewer and tests.",
    filesExpectedToChange: [
      "src/review/diff-reviewer.ts",
      "tests/unit/review/diff-reviewer.test.ts"
    ],
    riskAssessment: {
      level: "medium",
      areas: ["local tooling"]
    },
    testPlan: "npm test -- --run tests/unit/review/diff",
    commandsToRun: ["npm test -- --run tests/unit/review/diff"],
    requestedAction: "implementation_review",
    rollbackPlan: "Revert the diff reviewer files.",
    openQuestions: [],
    ...overrides
  };
}

function makeGitState(overrides: Partial<GitState> = {}): GitState {
  return {
    cwd: "C:/workspace/project",
    branch: "feature/diff-review",
    changedFiles: [
      "src/review/diff-reviewer.ts",
      "tests/unit/review/diff-reviewer.test.ts"
    ],
    diffText: "diff --git a/src/review/diff-reviewer.ts b/src/review/diff-reviewer.ts",
    statusText: " M src/review/diff-reviewer.ts\n M tests/unit/review/diff-reviewer.test.ts",
    ...overrides
  };
}

describe("reviewDiff", () => {
  it("approves an implementation diff when all changed files match the proposal", () => {
    const decision = reviewDiff({
      proposal: makeProposal(),
      gitState: makeGitState()
    });

    expect(decision.decision).toBe("approve");
    expect(decision.summary).toContain("matches the approved proposal scope");
    expect(decision.requiredChanges).toEqual([]);
    expect(decision.approvedActions).toContain("Proceed to secret scan.");
  });

  it("requests changes with path-level detail for unexpected files", () => {
    const decision = reviewDiff({
      proposal: makeProposal(),
      gitState: makeGitState({
        changedFiles: [
          "src/review/diff-reviewer.ts",
          "src/cli/index.ts"
        ]
      })
    });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain(
      "Remove or justify unexpected file change: src/cli/index.ts."
    );
    expect(decision.risks).toContain(
      "Actual diff includes file outside proposal scope: src/cli/index.ts"
    );
  });

  it("blocks sensitive path changes", () => {
    const decision = reviewDiff({
      proposal: makeProposal({
        filesExpectedToChange: ["src/review/diff-reviewer.ts"]
      }),
      gitState: makeGitState({
        changedFiles: ["src/review/diff-reviewer.ts", ".env.production"]
      })
    });

    expect(decision.decision).toBe("block");
    expect(decision.requiredChanges).toContain(
      "Remove sensitive file change or provide explicit human approval and an updated proposal: .env.production."
    );
    expect(decision.risks).toContain(
      "Sensitive path changed: .env.production (environment or secret-bearing file)"
    );
    expect(decision.blockedActions).toContain("Do not push the branch.");
  });

  it("blocks configured sensitive paths even when they are listed in the proposal", () => {
    const decision = reviewDiff({
      proposal: makeProposal({
        filesExpectedToChange: ["infra/prod/app.yml"]
      }),
      gitState: makeGitState({
        changedFiles: ["infra/prod/app.yml"]
      }),
      additionalSensitivePaths: ["infra/prod/**"]
    });

    expect(decision.decision).toBe("block");
    expect(decision.requiredChanges).toContain(
      "Remove sensitive file change or provide explicit human approval and an updated proposal: infra/prod/app.yml."
    );
    expect(decision.risks).toContain(
      "Sensitive path changed: infra/prod/app.yml (project configured sensitive path)"
    );
  });

  it("blocks credential-like values found in the diff without exposing the value", () => {
    const fakeToken = "synthetic-test-secret-token";

    const decision = reviewDiff({
      proposal: makeProposal(),
      gitState: makeGitState({
        diffText: [
          "diff --git a/src/review/diff-reviewer.ts b/src/review/diff-reviewer.ts",
          "+++ b/src/review/diff-reviewer.ts",
          `+const token = "${fakeToken}";`
        ].join("\n")
      })
    });
    const serializedDecision = JSON.stringify(decision);

    expect(decision.decision).toBe("block");
    expect(decision.risks).toContain(
      "Secret-like value detected in src/review/diff-reviewer.ts: token"
    );
    expect(decision.blockedActions).toEqual(
      expect.arrayContaining([
        "Do not push the branch.",
        "Do not create a PR.",
        "Do not merge the PR."
      ])
    );
    expect(serializedDecision).not.toContain(fakeToken);
  });

  it("requests changes when the diff is broader than the configured limit", () => {
    const decision = reviewDiff({
      proposal: makeProposal({
        filesExpectedToChange: [
          "src/review/a.ts",
          "src/review/b.ts",
          "src/review/c.ts",
          "src/review/d.ts"
        ]
      }),
      gitState: makeGitState({
        changedFiles: [
          "src/review/a.ts",
          "src/review/b.ts",
          "src/review/c.ts",
          "src/review/d.ts"
        ]
      }),
      maxChangedFiles: 3
    });

    expect(decision.decision).toBe("request_changes");
    expect(decision.requiredChanges).toContain(
      "Reduce the diff scope or update the proposal for a broad change set: 4 files changed, limit is 3."
    );
  });
});
