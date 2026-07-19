import type { Decision } from "../domain/types.js";

export interface DecisionJsonResult {
  schemaVersion: "codepm.decision.v1";
  decision: Decision;
}

export function formatDecisionMarkdown(decision: Decision): string {
  return [
    "# PM Gate Decision",
    "",
    `Decision: ${decision.decision}`,
    "",
    "## Summary",
    "",
    decision.summary,
    "",
    "## Required Changes",
    "",
    formatList(decision.requiredChanges),
    "",
    "## Risks",
    "",
    formatList(decision.risks),
    "",
    "## Verification Required",
    "",
    formatList(decision.verificationRequired),
    "",
    "## Approved Actions",
    "",
    formatList(decision.approvedActions),
    "",
    "## Blocked Actions",
    "",
    formatList(decision.blockedActions)
  ].join("\n");
}

export function formatDecisionJson(decision: Decision): string {
  return JSON.stringify(toDecisionJson(decision), null, 2);
}

export function toDecisionJson(decision: Decision): DecisionJsonResult {
  return {
    schemaVersion: "codepm.decision.v1",
    decision
  };
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "None.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}
