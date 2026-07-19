import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Decision, Proposal } from "../../../src/domain/types.js";
import type { GitHubPullRequestState } from "../../../src/integrations/github/github-types.js";
import type {
  GitHubCreatePullRequestInput,
  GitHubMergePullRequestInput,
  GitHubMutationAdapter
} from "../../../src/integrations/github/github-mutation-port.js";
import type { ApprovalEvidence } from "../../../src/policy/approval-evidence.js";
import { runExecutionPreflight } from "../../../src/execution/execution-preflight.js";
import {
  executeGitHubCreatePullRequest,
  executeGitHubMergePullRequest
} from "../../../src/execution/adapters/github-pr-adapter.js";

const tempDirs: string[] = [];

const approvalDecision: Decision = {
  decision: "approve",
  summary: "The requested GitHub action is approved.",
  requiredChanges: [],
  risks: [],
  verificationRequired: ["Re-check state before executing."],
  approvedActions: ["Proceed to execution preflight."],
  blockedActions: ["Do not execute if state changes."]
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-github-pr-unit-"));
  tempDirs.push(dir);
  return dir;
}

function readGithubFixture(name: string): GitHubPullRequestState {
  return JSON.parse(
    readFileSync(`tests/fixtures/github/${name}.json`, "utf8")
  ) as GitHubPullRequestState;
}

function readApprovalFixture(): ApprovalEvidence {
  return JSON.parse(
    readFileSync("tests/fixtures/approvals/merge-pr-approval.json", "utf8")
  ) as ApprovalEvidence;
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    goal: "Add CodePM GitHub mutation adapters",
    context: "CodePM needs guarded GitHub PR mutations.",
    proposedChanges: "Create or merge a PR only after PM preflight.",
    filesExpectedToChange: [
      "src/integrations/github/github-types.ts",
      "src/integrations/github/github-port.ts"
    ],
    riskAssessment: {
      level: "medium",
      areas: ["GitHub mutation"]
    },
    testPlan: "npm test -- --run tests/unit/execution/github-pr-adapter",
    commandsToRun: ["npm test -- --run tests/unit/execution/github-pr-adapter"],
    requestedAction: "merge_pr",
    rollbackPlan: "Revert the PR branch or follow up with a corrective PR.",
    openQuestions: [],
    ...overrides
  };
}

function createPreflight(action: "create_pr" | "merge_pr", risk = "low" as const) {
  const scope = {
    repo: "octo/example",
    branch: "feature/github-read-model",
    prNumber: action === "merge_pr" ? 42 : undefined,
    expectedHeadSha: "abc123passing",
    filesChanged: [
      "src/integrations/github/github-types.ts",
      "src/integrations/github/github-port.ts"
    ]
  };

  return runExecutionPreflight({
    decision: approvalDecision,
    approvedAction: action,
    requestedAction: action,
    riskLevel: risk,
    reviewedScope: scope,
    currentScope: scope,
    approval: risk === "low" ? undefined : readApprovalFixture(),
    now: "2026-05-25T00:30:00.000Z"
  });
}

function blockedPreflight() {
  const scope = {
    repo: "octo/example",
    branch: "feature/github-read-model",
    prNumber: 42,
    expectedHeadSha: "abc123passing",
    filesChanged: [
      "src/integrations/github/github-types.ts",
      "src/integrations/github/github-port.ts"
    ]
  };

  return runExecutionPreflight({
    decision: {
      ...approvalDecision,
      decision: "request_changes"
    },
    approvedAction: "merge_pr",
    requestedAction: "merge_pr",
    riskLevel: "low",
    reviewedScope: scope,
    currentScope: scope,
    now: "2026-05-25T00:30:00.000Z"
  });
}

function fakeMutationAdapter(): {
  adapter: GitHubMutationAdapter;
  created: GitHubCreatePullRequestInput[];
  merged: GitHubMergePullRequestInput[];
} {
  const created: GitHubCreatePullRequestInput[] = [];
  const merged: GitHubMergePullRequestInput[] = [];

  return {
    created,
    merged,
    adapter: {
      createPullRequest(input) {
        created.push(input);

        return {
          ok: true,
          action: "create_pr",
          repo: input.repo,
          prNumber: 77,
          url: "https://github.com/octo/example/pull/77",
          result: "created",
          headSha: input.expectedHeadSha,
          stateReadAt: "2026-05-25T00:31:00.000Z"
        };
      },
      mergePullRequest(input) {
        merged.push(input);

        return {
          ok: true,
          action: "merge_pr",
          repo: input.repo,
          prNumber: input.prNumber,
          url: `https://github.com/${input.repo}/pull/${input.prNumber}`,
          result: "merged",
          headSha: input.expectedHeadSha,
          stateReadAt: "2026-05-25T00:31:00.000Z",
          mergeSha: "merge-sha-123"
        };
      }
    }
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("executeGitHubCreatePullRequest", () => {
  it("creates a PR after preflight when metadata includes title, branches, tests, and rollback", () => {
    const auditPath = join(makeTempDir(), "audit.jsonl");
    const proposal = makeProposal({ requestedAction: "create_pr" });
    const body = [proposal.proposedChanges, proposal.testPlan, proposal.rollbackPlan].join(
      "\n\n"
    );
    const { adapter, created } = fakeMutationAdapter();

    const result = executeGitHubCreatePullRequest({
      adapter,
      preflight: createPreflight("create_pr"),
      proposal,
      repo: "octo/example",
      baseRef: "main",
      headRef: "feature/github-read-model",
      expectedHeadSha: "abc123passing",
      title: proposal.goal,
      body,
      auditLogPath: auditPath,
      now: "2026-05-25T00:31:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "created",
        url: "https://github.com/octo/example/pull/77"
      })
    );
    expect(created).toHaveLength(1);
    expect(JSON.parse(readFileSync(auditPath, "utf8").trim())).toEqual(
      expect.objectContaining({
        requestedAction: "create_pr",
        decision: "approve",
        reason: "GitHub PR creation succeeded for octo/example.",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/77",
          result: "created",
          stateReadAt: "2026-05-25T00:31:00.000Z"
        })
      })
    );
  });

  it("blocks PR creation when title, branch refs, test plan, or rollback are missing", () => {
    const proposal = makeProposal({ requestedAction: "create_pr" });
    const { adapter, created } = fakeMutationAdapter();

    const result = executeGitHubCreatePullRequest({
      adapter,
      preflight: createPreflight("create_pr"),
      proposal,
      repo: "octo/example",
      baseRef: "",
      headRef: "",
      expectedHeadSha: "abc123passing",
      title: "",
      body: "Missing required evidence."
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "missing_base_ref",
        "missing_head_ref",
        "metadata_invalid",
        "metadata_invalid"
      ])
    );
    expect(created).toEqual([]);
  });
});

describe("executeGitHubMergePullRequest", () => {
  it("merges a PR after preflight when CI, reviews, threads, scope, and head SHA are fresh", () => {
    const auditPath = join(makeTempDir(), "audit.jsonl");
    const proposal = makeProposal();
    const prState = readGithubFixture("passing-pr");
    const { adapter, merged } = fakeMutationAdapter();

    const result = executeGitHubMergePullRequest({
      adapter,
      preflight: createPreflight("merge_pr", "medium"),
      proposal,
      prState,
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"],
      auditLogPath: auditPath,
      now: "2026-05-25T00:31:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "merged",
        url: "https://github.com/octo/example/pull/42"
      })
    );
    expect(merged[0]).toEqual(
      expect.objectContaining({
        repo: "octo/example",
        prNumber: 42,
        expectedHeadSha: "abc123passing"
      })
    );
    expect(JSON.parse(readFileSync(auditPath, "utf8").trim())).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        reason: "GitHub PR merge succeeded for octo/example#42.",
        github: expect.objectContaining({
          url: "https://github.com/octo/example/pull/42",
          result: "merged",
          stateReadAt: "2026-05-25T00:31:00.000Z",
          prStateReadAt: "2026-05-25T00:00:00.000Z",
          mergeSha: "merge-sha-123"
        })
      })
    );
  });

  it("blocks merge when preflight is blocked", () => {
    const proposal = makeProposal();
    const { adapter, merged } = fakeMutationAdapter();

    const result = executeGitHubMergePullRequest({
      adapter,
      preflight: blockedPreflight(),
      proposal,
      prState: readGithubFixture("passing-pr"),
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "preflight_blocked"
    );
    expect(merged).toEqual([]);
  });

  it("blocks merge when fresh GitHub state no longer matches reviewed evidence", () => {
    const proposal = makeProposal();
    const prState = {
      ...readGithubFixture("passing-pr"),
      headSha: "new-head"
    };
    const { adapter, merged } = fakeMutationAdapter();

    const result = executeGitHubMergePullRequest({
      adapter,
      preflight: createPreflight("merge_pr", "medium"),
      proposal,
      prState,
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain(
      "pr_gate_blocked"
    );
    expect(result.findings.map((finding) => finding.message).join("\n")).toContain(
      "PR head SHA changed from abc123passing to new-head."
    );
    expect(merged).toEqual([]);
  });

  it("reports mutation failures without claiming merge success", () => {
    const proposal = makeProposal();
    const prState = readGithubFixture("passing-pr");
    const adapter = fakeMutationAdapter().adapter;
    adapter.mergePullRequest = () => ({
      ok: false,
      action: "merge_pr",
      code: "conflict",
      message: "GitHub rejected the merge."
    });

    const result = executeGitHubMergePullRequest({
      adapter,
      preflight: createPreflight("merge_pr", "medium"),
      proposal,
      prState,
      expectedHeadSha: "abc123passing",
      requiredCheckNames: ["test"]
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.findings.map((finding) => finding.code)).toContain(
      "mutation_failed"
    );
  });
});
