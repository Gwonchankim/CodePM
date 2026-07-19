import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readClaudeTranscript } from "../../../src/integrations/claude-cli/transcript-reader.js";
import { normalizeClaudeOutput } from "../../../src/orchestration/claude-output-normalizer.js";

function readFixture(path: string): string {
  return readFileSync(path, "utf8");
}

describe("normalizeClaudeOutput", () => {
  it("extracts proposal, test evidence, and action request blocks from noisy Claude output", () => {
    const transcript = readFixture(
      "tests/fixtures/claude-transcripts/valid-structured-transcript.txt"
    );

    const result = normalizeClaudeOutput(transcript);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.proposal.goal).toBe("Review Claude CLI transcript output.");
    expect(result.proposal.filesExpectedToChange).toEqual([
      "src/orchestration/claude-output-normalizer.ts",
      "src/integrations/claude-cli/transcript-reader.ts",
      "tests/unit/orchestration/claude-output-normalizer.test.ts"
    ]);
    expect(result.proposal.requestedAction).toBe("plan_review");
    expect(result.testEvidence).toContain("Result: passed");
    expect(result.actionRequest).toEqual({
      requestedAction: "implementation_review",
      source: "claude_cli",
      branch: "feature/claude-output-normalizer",
      expectedHeadSha: "abc1234"
    });
    expect(result.blocks.map((block) => block.kind)).toEqual([
      "proposal",
      "test_evidence",
      "action_request"
    ]);
  });

  it("returns Claude-facing feedback when the required proposal block is missing", () => {
    const transcript = readFixture(
      "tests/fixtures/claude-transcripts/missing-proposal-transcript.txt"
    );

    const result = normalizeClaudeOutput(transcript);

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "missing_proposal_block"
      })
    );
    expect(result.feedbackForClaude).toContain("```codepm-proposal");
    expect(result.feedbackForClaude).toContain("Claude Work Proposal");
  });
});

describe("readClaudeTranscript", () => {
  it("reads a Claude transcript from disk", () => {
    const transcript = readClaudeTranscript(
      "tests/fixtures/claude-transcripts/valid-structured-transcript.txt"
    );

    expect(transcript).toContain("Claude Code session");
    expect(transcript).toContain("```codepm-proposal");
  });
});
