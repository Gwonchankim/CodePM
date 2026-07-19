import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Decision } from "../../../src/domain/types.js";
import type {
  ApprovalEvidence,
  ApprovalScope
} from "../../../src/policy/approval-evidence.js";
import { isHumanApprovalRequired } from "../../../src/policy/approval-evidence.js";
import { validateApprovalEvidence } from "../../../src/policy/approval-validator.js";

const validDecision: Decision = {
  decision: "approve",
  summary: "The PR is merge-ready.",
  requiredChanges: [],
  risks: [],
  verificationRequired: ["Re-check PR state before merge."],
  approvedActions: ["Proceed to execution preflight for merge_pr."],
  blockedActions: ["Do not merge if the PR head SHA changes."]
};

const currentScope: ApprovalScope = {
  repo: "octo/example",
  branch: "feature/github-read-model",
  prNumber: 42,
  expectedHeadSha: "abc123passing",
  filesChanged: [
    "src/integrations/github/github-types.ts",
    "src/integrations/github/github-port.ts"
  ]
};

function readApprovalFixture(): ApprovalEvidence {
  return JSON.parse(
    readFileSync("tests/fixtures/approvals/merge-pr-approval.json", "utf8")
  ) as ApprovalEvidence;
}

function validationErrorCodes(
  result: ReturnType<typeof validateApprovalEvidence>
): string[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe("ApprovalEvidence", () => {
  it("records approver, timestamp, repo, branch, PR, action, risk, and scope", () => {
    const approval = readApprovalFixture();

    expect(approval).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.approval.v1",
        approver: "amole",
        approvedAt: "2026-05-25T00:05:00.000Z",
        requestedAction: "merge_pr",
        riskLevel: "medium",
        scope: expect.objectContaining({
          repo: "octo/example",
          branch: "feature/github-read-model",
          prNumber: 42,
          expectedHeadSha: "abc123passing",
          filesChanged: expect.arrayContaining([
            "src/integrations/github/github-types.ts"
          ])
        })
      })
    );
  });

  it("requires approval only for medium-risk and high-risk mutation actions", () => {
    expect(isHumanApprovalRequired("merge_pr", "medium")).toBe(true);
    expect(isHumanApprovalRequired("push_branch", "high")).toBe(true);
    expect(isHumanApprovalRequired("create_pr", "low")).toBe(false);
    expect(isHumanApprovalRequired("implementation_review", "high")).toBe(false);
  });
});

describe("validateApprovalEvidence", () => {
  it("accepts approval scoped to the exact approved decision and current state", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "merge_pr",
      riskLevel: "medium",
      currentScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        approvalRequired: true
      })
    );
  });

  it("blocks medium-risk mutation execution when approval is missing", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "merge_pr",
      riskLevel: "medium",
      currentScope,
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(validationErrorCodes(result)).toContain("approval_missing");
  });

  it("does not let approval for one action authorize another action", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "push_branch",
      riskLevel: "medium",
      currentScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(validationErrorCodes(result)).toContain("action_mismatch");
  });

  it("blocks approval when the decision is not approved", () => {
    const result = validateApprovalEvidence({
      decision: {
        ...validDecision,
        decision: "request_changes",
        summary: "The PR needs fixes."
      },
      requestedAction: "merge_pr",
      riskLevel: "medium",
      currentScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(validationErrorCodes(result)).toContain("decision_not_approved");
  });

  it("blocks approval when repo, PR, head SHA, or files no longer match", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "merge_pr",
      riskLevel: "medium",
      currentScope: {
        ...currentScope,
        repo: "octo/other",
        prNumber: 99,
        expectedHeadSha: "new-head",
        filesChanged: ["src/unexpected.ts"]
      },
      approval: readApprovalFixture(),
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(validationErrorCodes(result)).toEqual(
      expect.arrayContaining([
        "scope_mismatch",
        "scope_mismatch",
        "scope_mismatch",
        "scope_mismatch"
      ])
    );
  });

  it("blocks expired approval evidence", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "merge_pr",
      riskLevel: "medium",
      currentScope,
      approval: readApprovalFixture(),
      now: "2026-05-25T01:06:00.000Z"
    });

    expect(result.ok).toBe(false);
    expect(validationErrorCodes(result)).toContain("approval_expired");
  });

  it("allows low-risk mutation execution without human approval evidence", () => {
    const result = validateApprovalEvidence({
      decision: validDecision,
      requestedAction: "merge_pr",
      riskLevel: "low",
      currentScope,
      now: "2026-05-25T00:30:00.000Z"
    });

    expect(result).toEqual({
      ok: true,
      approvalRequired: false,
      approval: undefined
    });
  });
});
