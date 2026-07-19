import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseProposalMarkdown } from "../../../src/parser/proposal-parser.js";

function readFixture(path: string): string {
  return readFileSync(path, "utf8");
}

describe("parseProposalMarkdown", () => {
  it("parses a valid Claude Work Proposal into a Proposal", () => {
    const markdown = readFixture("tests/fixtures/proposals/valid-plan.md");

    const result = parseProposalMarkdown(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected proposal parser to succeed");
    }

    expect(result.proposal.goal).toContain("Add the first local CodePM review flow");
    expect(result.proposal.filesExpectedToChange).toEqual([
      "src/parser/",
      "tests/unit/parser/",
      "tests/fixtures/proposals/",
      "docs/schema.md"
    ]);
    expect(result.proposal.riskAssessment).toEqual({
      level: "low",
      areas: ["local tooling", "parser behavior", "test fixtures"]
    });
    expect(result.proposal.commandsToRun).toEqual([
      "npm test -- --run tests/unit/parser"
    ]);
    expect(result.proposal.requestedAction).toBe("plan_review");
    expect(result.extraSections).toEqual({});
  });

  it("returns validation errors when required sections are missing", () => {
    const markdown = readFixture("tests/fixtures/proposals/missing-test-plan.md");

    const result = parseProposalMarkdown(markdown);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected proposal parser to fail");
    }

    expect(result.errors).toContainEqual({
      code: "missing_required_section",
      section: "Test Plan",
      message: "Missing required section: Test Plan"
    });
  });

  it("returns validation errors for duplicate required sections", () => {
    const markdown = `${readFixture("tests/fixtures/proposals/valid-plan.md")}

## Goal

This duplicate goal should make the proposal ambiguous.
`;

    const result = parseProposalMarkdown(markdown);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected proposal parser to fail");
    }

    expect(result.errors).toContainEqual({
      code: "duplicate_section",
      section: "Goal",
      message: "Duplicate section: Goal"
    });
  });

  it("preserves unknown extra sections without failing parsing", () => {
    const markdown = `${readFixture("tests/fixtures/proposals/valid-plan.md")}

## Notes For Reviewer

This should be preserved for future review context.
`;

    const result = parseProposalMarkdown(markdown);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected proposal parser to succeed");
    }

    expect(result.extraSections).toEqual({
      "Notes For Reviewer": "This should be preserved for future review context."
    });
  });
});
