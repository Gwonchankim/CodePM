import { describe, expect, it } from "vitest";

import type { Decision } from "../../../src/domain/types.js";
import {
  formatDecisionJson,
  formatDecisionMarkdown
} from "../../../src/review/decision-formatter.js";
import {
  formatClaudeFeedback,
  toClaudeFeedback
} from "../../../src/review/claude-feedback-formatter.js";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    decision: "approve",
    summary: "The plan is complete, low risk, and ready for implementation.",
    requiredChanges: [],
    risks: ["Proposal declares low risk"],
    verificationRequired: [
      "Run the proposed verification steps after implementation."
    ],
    approvedActions: ["Proceed with implementation."],
    blockedActions: ["Do not push, create a PR, or merge from this plan alone."],
    ...overrides
  };
}

describe("decision formatter", () => {
  it("formats a PM Gate Decision Markdown document", () => {
    const markdown = formatDecisionMarkdown(makeDecision());

    expect(markdown).toContain("# PM Gate Decision");
    expect(markdown).toContain("Decision: approve");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain(
      "The plan is complete, low risk, and ready for implementation."
    );
    expect(markdown).toContain("## Required Changes\n\nNone.");
    expect(markdown).toContain("- Proposal declares low risk");
    expect(markdown).toContain("- Proceed with implementation.");
    expect(markdown).toContain(
      "- Do not push, create a PR, or merge from this plan alone."
    );
  });

  it("serializes a structured decision JSON result for later commands", () => {
    const json = formatDecisionJson(makeDecision({ decision: "request_changes" }));

    expect(JSON.parse(json)).toEqual({
      schemaVersion: "codepm.decision.v1",
      decision: makeDecision({ decision: "request_changes" })
    });
  });
});

describe("Claude feedback formatter", () => {
  it("maps PM decisions into Claude-facing feedback fields", () => {
    const feedback = toClaudeFeedback(
      makeDecision({
        decision: "request_changes",
        requiredChanges: ["Add parser tests for duplicate sections."],
        verificationRequired: ["Submit a revised Claude Work Proposal."],
        approvedActions: ["Revise the Claude Work Proposal."],
        blockedActions: ["Do not start implementation."]
      })
    );

    expect(feedback).toEqual({
      decision: "request_changes",
      summary: "The plan is complete, low risk, and ready for implementation.",
      requiredChanges: ["Add parser tests for duplicate sections."],
      evidenceToProvideNext: ["Submit a revised Claude Work Proposal."],
      approvedActions: ["Revise the Claude Work Proposal."],
      blockedActions: ["Do not start implementation."]
    });
  });

  it("formats pasteable PM feedback for Claude Code", () => {
    const markdown = formatClaudeFeedback(
      makeDecision({
        decision: "block",
        requiredChanges: ["Provide explicit human approval evidence."],
        verificationRequired: ["Provide approval scoped to PR #123."],
        approvedActions: ["Revise the Claude Work Proposal."],
        blockedActions: ["Do not merge the PR."]
      })
    );

    expect(markdown).toContain("# PM Feedback For Claude");
    expect(markdown).toContain("Decision: block");
    expect(markdown).toContain("## Required Changes");
    expect(markdown).toContain("- Provide explicit human approval evidence.");
    expect(markdown).toContain("## Evidence To Provide Next");
    expect(markdown).toContain("- Provide approval scoped to PR #123.");
    expect(markdown).toContain("- Do not merge the PR.");
  });
});
