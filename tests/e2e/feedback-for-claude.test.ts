import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Decision } from "../../src/domain/types.js";
import { formatDecisionJson } from "../../src/review/decision-formatter.js";
import { runCli } from "../../src/cli/index.js";

function writeDecisionFile(decision: Decision): string {
  const dir = mkdtempSync(join(tmpdir(), "codepm-feedback-"));
  const path = join(dir, "decision.json");
  writeFileSync(path, formatDecisionJson(decision), "utf8");
  return path;
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decision: "request_changes",
    summary: "The implementation evidence needs one correction.",
    requiredChanges: ["Remove or justify unexpected file change: src/cli/index.ts."],
    risks: ["Actual diff includes file outside proposal scope: src/cli/index.ts"],
    verificationRequired: ["Re-run review-diff after correcting the scope."],
    approvedActions: ["Revise the implementation diff."],
    blockedActions: ["Do not push, create a PR, or merge until corrected."],
    ...overrides
  };
}

describe("codepm feedback-for-claude", () => {
  it("prints Claude-facing feedback from a decision JSON file", () => {
    const decisionPath = writeDecisionFile(makeDecision());
    const output = vi.fn();

    const exitCode = runCli(
      ["feedback-for-claude", "--decision", decisionPath],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Feedback For Claude");
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain(
      "- Remove or justify unexpected file change: src/cli/index.ts."
    );
    expect(text).toContain("- Re-run review-diff after correcting the scope.");
    expect(text).toContain("- Revise the implementation diff.");
    expect(text).toContain(
      "- Do not push, create a PR, or merge until corrected."
    );
    expect(text).not.toContain("# PM Gate Decision");
    expect(text).not.toContain("## Risks");
  });

  it("redacts secret-like values before printing feedback", () => {
    const fakeToken = "synthetic-test-secret-token";
    const decisionPath = writeDecisionFile(
      makeDecision({
        decision: "block",
        summary: `Secret-like value detected: token=${fakeToken}`,
        requiredChanges: [`Remove token=${fakeToken} from README.md.`],
        verificationRequired: ["Rotate the credential if it was real."],
        approvedActions: ["Revise the implementation diff."],
        blockedActions: ["Do not push the branch."]
      })
    );
    const output = vi.fn();

    const exitCode = runCli(
      ["feedback-for-claude", "--decision", decisionPath],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("***REDACTED***");
    expect(text).not.toContain(fakeToken);
  });

  it("returns actionable output when the decision path is missing", () => {
    const output = vi.fn();

    const exitCode = runCli(["feedback-for-claude"], output);

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Missing decision path."
    );
  });

  it("returns actionable output for invalid decision JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "codepm-feedback-invalid-"));
    const path = join(dir, "decision.json");
    writeFileSync(path, JSON.stringify({ decision: "approve" }), "utf8");
    const output = vi.fn();

    const exitCode = runCli(["feedback-for-claude", "--decision", path], output);

    expect(exitCode).toBe(1);
    expect(output.mock.calls[0]?.[0] ?? "").toContain(
      "Invalid decision JSON."
    );
  });
});
