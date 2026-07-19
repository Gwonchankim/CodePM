export const DECISIONS = ["approve", "request_changes", "block"] as const;

export type DecisionValue = (typeof DECISIONS)[number];

const decisionSet = new Set<string>(DECISIONS);

export function isDecision(value: unknown): value is DecisionValue {
  return typeof value === "string" && decisionSet.has(value);
}
