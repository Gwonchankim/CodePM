import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Decision } from "../../../src/domain/types.js";
import type { ApprovalEvidence } from "../../../src/policy/approval-evidence.js";
import type { ExecutionScope } from "../../../src/execution/execution-scope.js";
import { runExecutionPreflight } from "../../../src/execution/execution-preflight.js";

const tempDirs: string[] = [];

const approvedDecision: Decision = {
  decision: "approve",
  summary: "The GitHub PR is merge-ready for merge_pr.",
  requiredChanges: [],
  risks: [],
  verificationRequired: [
    "Re-check GitHub PR state before executing any mutation."
  ],
  approvedActions: ["Proceed to execution preflight for merge_pr."],
  blockedActions: ["Do not merge if the PR head SHA changes before execution."]
};

const reviewedScope: ExecutionScope = {
  repo: "octo/example",
  branch: "feature/github-read-model",
  prNumber: 42,
  expectedHeadSha: "abc123passing",
  filesChanged: [
    "src/integrations/github/github-types.ts",
    "src/integrations/github/github-port.ts"
  ]
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-preflight-"));
  tempDirs.push(dir);
  return dir;
}

function readApprovalFixture(): ApprovalEvidence {
  return JSON.parse(
    readFileSync("tests/fixtures/approvals/merge-pr-approval.json", "utf8")
  ) as ApprovalEvidence;
}

function findingCodes(result: ReturnType<typeof runExecutionPreflight>): string[] {
  return result.ok ? [] : result.findings.map((finding) => finding.code);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("runExecutionPreflight", () => {
  it("allows an approved action when approval and fresh state match", () => {
    const auditPath = join(makeTempDir(), "audit.jsonl");

    const result = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "medium",
      reviewedScope,
      currentScope: reviewedScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z",
      auditLogPath: auditPath,
      testEvidence: "npm test"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "allow",
        approvalRequired: true
      })
    );

    const auditLines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(auditLines).toHaveLength(2);
    expect(JSON.parse(auditLines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        reason: "Execution preflight started for merge_pr.",
        humanApprovalRequired: true,
        humanApprovalGranted: true
      })
    );
    expect(JSON.parse(auditLines[1] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "merge_pr",
        decision: "approve",
        reason: "Execution preflight allowed merge_pr.",
        filesChanged: reviewedScope.filesChanged,
        github: expect.objectContaining({
          repo: "octo/example",
          prNumber: 42,
          expectedHeadSha: "abc123passing"
        })
      })
    );
  });

  it("blocks execution when the PM decision is not approved", () => {
    const result = runExecutionPreflight({
      decision: {
        ...approvedDecision,
        decision: "request_changes",
        summary: "The PR needs fixes."
      },
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "medium",
      reviewedScope,
      currentScope: reviewedScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(findingCodes(result)).toContain("decision_not_approved");
  });

  it("blocks execution when a decision for one action is reused for another", () => {
    const result = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "merge_pr",
      requestedAction: "push_branch",
      riskLevel: "medium",
      reviewedScope,
      currentScope: reviewedScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(findingCodes(result)).toContain("action_mismatch");
  });

  it("blocks execution when fresh repo, PR, head SHA, or files changed", () => {
    const result = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "medium",
      reviewedScope,
      currentScope: {
        ...reviewedScope,
        repo: "octo/other",
        prNumber: 99,
        expectedHeadSha: "new-head",
        filesChanged: ["src/unexpected.ts"]
      },
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(findingCodes(result)).toEqual(
      expect.arrayContaining([
        "scope_mismatch",
        "scope_mismatch",
        "scope_mismatch",
        "scope_mismatch"
      ])
    );
  });

  it("blocks medium-risk mutation execution when approval evidence is missing", () => {
    const result = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "medium",
      reviewedScope,
      currentScope: reviewedScope,
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(findingCodes(result)).toContain("approval_missing");
  });

  it("allows low-risk mutation execution without approval when state is fresh", () => {
    const result = runExecutionPreflight({
      decision: approvedDecision,
      approvedAction: "merge_pr",
      requestedAction: "merge_pr",
      riskLevel: "low",
      reviewedScope,
      currentScope: reviewedScope,
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "allow",
        approvalRequired: false
      })
    );
  });
});
