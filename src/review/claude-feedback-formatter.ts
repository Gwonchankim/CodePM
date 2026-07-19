import type { ClaudeFeedback, Decision } from "../domain/types.js";
import { redactSecrets } from "../policy/redaction.js";

export function toClaudeFeedback(decision: Decision): ClaudeFeedback {
  return {
    decision: decision.decision,
    summary: decision.summary,
    requiredChanges: decision.requiredChanges,
    evidenceToProvideNext: decision.verificationRequired,
    approvedActions: decision.approvedActions,
    blockedActions: decision.blockedActions
  };
}

export function formatClaudeFeedback(decision: Decision): string {
  const feedback = toClaudeFeedback(decision);

  return redactSecrets([
    "# PM Feedback For Claude",
    "",
    `Decision: ${feedback.decision}`,
    "",
    "## Summary",
    "",
    feedback.summary,
    "",
    "## Required Changes",
    "",
    formatList(feedback.requiredChanges),
    "",
    "## Evidence To Provide Next",
    "",
    formatList(feedback.evidenceToProvideNext),
    "",
    "## Approved Actions",
    "",
    formatList(feedback.approvedActions),
    "",
    "## Blocked Actions",
    "",
    formatList(feedback.blockedActions)
  ].join("\n"));
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "None.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}
