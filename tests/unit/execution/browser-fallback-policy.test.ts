import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyBrowserFallbackRisk,
  evaluateBrowserFallbackPolicy,
  type BrowserFallbackApproval,
  type BrowserFallbackTarget
} from "../../../src/integrations/browser/browser-fallback-policy.js";
import { executeBrowserFallbackAction } from "../../../src/execution/adapters/browser-action-adapter.js";

const tempDirs: string[] = [];

const target: BrowserFallbackTarget = {
  repo: "octo/example",
  prNumber: 42,
  branch: "feature/browser-fallback"
};

const approval: BrowserFallbackApproval = {
  approved: true,
  approver: "amole",
  approvedAt: "2026-05-25T00:30:00.000Z",
  action: "merge_pr",
  target
};

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-browser-fallback-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();

    if (dir) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});

describe("evaluateBrowserFallbackPolicy", () => {
  it("allows a GitHub UI fallback only when structured adapters cannot perform the exact approved action", () => {
    const result = evaluateBrowserFallbackPolicy({
      action: "merge_pr",
      target,
      sourceCommand: "execute-action",
      structuredAdapterAvailable: false,
      approval
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "allow",
        riskLevel: "high"
      })
    );
  });

  it("blocks fallback when explicit approval is missing or for a different action", () => {
    const missingApproval = evaluateBrowserFallbackPolicy({
      action: "merge_pr",
      target,
      sourceCommand: "execute-action",
      structuredAdapterAvailable: false
    });
    const differentAction = evaluateBrowserFallbackPolicy({
      action: "merge_pr",
      target,
      sourceCommand: "execute-action",
      structuredAdapterAvailable: false,
      approval: {
        ...approval,
        action: "dismiss_review"
      }
    });

    expect(missingApproval.ok).toBe(false);
    expect(missingApproval.findings.map((finding) => finding.code)).toContain(
      "approval_missing"
    );
    expect(differentAction.ok).toBe(false);
    expect(differentAction.findings.map((finding) => finding.code)).toContain(
      "approval_action_mismatch"
    );
  });

  it("blocks fallback from review-only commands and when a structured adapter is available", () => {
    const reviewOnly = evaluateBrowserFallbackPolicy({
      action: "merge_pr",
      target,
      sourceCommand: "review-pr",
      structuredAdapterAvailable: false,
      approval
    });
    const structuredAdapter = evaluateBrowserFallbackPolicy({
      action: "merge_pr",
      target,
      sourceCommand: "execute-action",
      structuredAdapterAvailable: true,
      approval
    });

    expect(reviewOnly.ok).toBe(false);
    expect(reviewOnly.findings.map((finding) => finding.code)).toContain(
      "review_only_command"
    );
    expect(structuredAdapter.ok).toBe(false);
    expect(structuredAdapter.findings.map((finding) => finding.code)).toContain(
      "structured_adapter_available"
    );
  });

  it("keeps destructive browser fallback actions high-risk", () => {
    expect(classifyBrowserFallbackRisk("merge_pr")).toBe("high");
    expect(classifyBrowserFallbackRisk("delete_branch")).toBe("high");
    expect(classifyBrowserFallbackRisk("force_push")).toBe("high");
    expect(classifyBrowserFallbackRisk("dismiss_review")).toBe("high");
    expect(classifyBrowserFallbackRisk("production_deploy")).toBe("high");
  });
});

describe("executeBrowserFallbackAction", () => {
  it("records intended action before execution and observed result after execution", () => {
    const auditPath = join(makeTempDir(), "browser-audit.jsonl");
    const calls: Array<{ action: string; target: BrowserFallbackTarget }> = [];

    const result = executeBrowserFallbackAction({
      action: "merge_pr",
      target,
      sourceCommand: "execute-action",
      structuredAdapterAvailable: false,
      approval,
      auditLogPath: auditPath,
      now: "2026-05-25T00:31:00.000Z",
      runner(input) {
        calls.push({ action: input.action, target: input.target });

        return {
          ok: true,
          observedResult: "Merged PR #42 through GitHub UI.",
          url: "https://github.com/octo/example/pull/42"
        };
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "completed",
        observedResult: "Merged PR #42 through GitHub UI."
      })
    );
    expect(calls).toEqual([{ action: "merge_pr", target }]);

    const auditLines = readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(auditLines).toHaveLength(2);
    expect(auditLines[0]).toEqual(
      expect.objectContaining({
        phase: "intended",
        action: "merge_pr",
        sourceCommand: "execute-action",
        decision: "approve"
      })
    );
    expect(auditLines[1]).toEqual(
      expect.objectContaining({
        phase: "observed",
        action: "merge_pr",
        decision: "approve",
        observedResult: "Merged PR #42 through GitHub UI."
      })
    );
  });

  it("does not call the Browser runner when policy blocks fallback", () => {
    const result = executeBrowserFallbackAction({
      action: "merge_pr",
      target,
      sourceCommand: "review-pr",
      structuredAdapterAvailable: false,
      approval,
      runner() {
        throw new Error("runner should not be called");
      }
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.findings.map((finding) => finding.code)).toContain(
      "review_only_command"
    );
  });
});
