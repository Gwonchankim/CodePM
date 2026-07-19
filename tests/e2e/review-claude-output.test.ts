import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../src/cli/index.js";

const validTranscriptPath =
  "tests/fixtures/claude-transcripts/valid-structured-transcript.txt";
const missingProposalTranscriptPath =
  "tests/fixtures/claude-transcripts/missing-proposal-transcript.txt";
const ambiguousActionTranscriptPath =
  "tests/fixtures/claude-transcripts/ambiguous-action-transcript.txt";

describe("codepm review-claude-output", () => {
  it("reviews a structured Claude transcript and prints a PM decision", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-claude-output", validTranscriptPath], output);

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Gate Decision");
    expect(text).toContain("Decision: approve");
    expect(text).toContain("The plan is complete");
  });

  it("prints structured JSON and audits the normalized requested action", () => {
    const output = vi.fn();
    const dir = mkdtempSync(join(tmpdir(), "codepm-review-claude-"));
    const auditPath = join(dir, "audit.jsonl");

    const exitCode = runCli(
      ["review-claude-output", validTranscriptPath, "--json", "--audit-log", auditPath],
      output
    );

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

    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        requestedAction: "implementation_review",
        decision: "approve",
        filesChanged: expect.arrayContaining([
          "src/orchestration/claude-output-normalizer.ts"
        ]),
        testEvidence: expect.stringContaining("Result: passed")
      })
    );
  });

  it("prints Claude-facing feedback when requested", () => {
    const output = vi.fn();

    const exitCode = runCli(
      ["review-claude-output", validTranscriptPath, "--feedback-for-claude"],
      output
    );

    expect(exitCode).toBe(0);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("# PM Feedback For Claude");
    expect(text).toContain("Decision: approve");
  });

  it("returns actionable feedback when the proposal block is missing", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-claude-output", missingProposalTranscriptPath], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain("Missing fenced codepm-proposal block.");
  });

  it("reports ambiguous action requests instead of guessing", () => {
    const output = vi.fn();

    const exitCode = runCli(["review-claude-output", ambiguousActionTranscriptPath], output);

    expect(exitCode).toBe(1);
    const text = output.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Decision: request_changes");
    expect(text).toContain(
      "Multiple codepm-action-request blocks found; provide exactly one."
    );
  });
});
