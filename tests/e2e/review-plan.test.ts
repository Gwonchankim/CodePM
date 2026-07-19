import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/index.js";

const validProposalPath = "tests/fixtures/proposals/valid-plan.md";
const invalidProposalPath = "tests/fixtures/proposals/missing-test-plan.md";

describe("codepm review-plan", () => {
  it("prints a PM Gate Decision Markdown document for a valid proposal", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-plan", validProposalPath], output);

    expect(exitCode).toBe(0);
    expect(output).toHaveBeenCalledOnce();
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Gate Decision");
    expect(text).toContain("Decision: approve");
    expect(text).toContain("- Proceed with implementation.");
  });

  it("prints structured JSON when --json is provided", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-plan", validProposalPath, "--json"], output);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(output.mock.calls[0]?.[0] ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        schemaVersion: "codepm.decision.v1",
        decision: expect.objectContaining({
          decision: "approve"
        })
      })
    );
  });

  it("prints Claude-facing feedback when --feedback-for-claude is provided", () => {
    const output = vi.fn();

    const exitCode = runCli(
      ["review-plan", validProposalPath, "--feedback-for-claude"],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Feedback For Claude");
    expect(text).toContain("Decision: approve");
    expect(text).toContain("- Proceed with implementation.");
  });

  it("returns a non-zero exit code and actionable feedback for invalid proposals", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-plan", invalidProposalPath], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain("- Add the required section: Test Plan.");
  });

  it("appends an audit entry when --audit-log is provided", () => {
    const output = vi.fn();
    const dir = mkdtempSync(join(tmpdir(), "codepm-review-plan-"));
    const auditPath = join(dir, "audit.jsonl");

    const exitCode = runCli(
      ["review-plan", validProposalPath, "--audit-log", auditPath],
      output
    );

    expect(exitCode).toBe(0);
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        actor: "codex-pm-gate",
        requestedAction: "plan_review",
        decision: "approve",
        filesChanged: expect.arrayContaining(["docs/schema.md"]),
        riskLevel: "low",
        humanApprovalRequired: false,
        humanApprovalGranted: null
      })
    );
  });
});
