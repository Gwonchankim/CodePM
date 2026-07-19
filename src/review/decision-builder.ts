import type { Decision } from "../domain/types.js";
import type { DecisionValue } from "../domain/decision.js";

export interface BuildDecisionInput {
  decision: DecisionValue;
  summary: string;
  requiredChanges?: string[];
  risks?: string[];
  verificationRequired?: string[];
  approvedActions?: string[];
  blockedActions?: string[];
}

export function buildDecision(input: BuildDecisionInput): Decision {
  return {
    decision: input.decision,
    summary: input.summary,
    requiredChanges: input.requiredChanges ?? [],
    risks: input.risks ?? [],
    verificationRequired: input.verificationRequired ?? [],
    approvedActions: input.approvedActions ?? [],
    blockedActions: input.blockedActions ?? []
  };
}
