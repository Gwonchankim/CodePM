import type {
  MatchedRiskRule,
  Proposal,
  RiskLevel,
  RiskResult
} from "../domain/types.js";
import { RISK_RULES } from "./risk-rules.js";

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const declaredRiskReasons: Record<RiskLevel, string> = {
  low: "Proposal declares low risk",
  medium: "Proposal declares medium risk",
  high: "Proposal declares high risk"
};

export function classifyRisk(proposal: Proposal): RiskResult {
  const text = proposalToSearchText(proposal);
  const matchedRules: MatchedRiskRule[] = [
    {
      id: "declared-risk",
      level: proposal.riskAssessment.level,
      reason: declaredRiskReasons[proposal.riskAssessment.level]
    }
  ];

  for (const rule of RISK_RULES) {
    if (rule.id === "declared-risk") {
      continue;
    }

    if (rule.patterns.some((pattern) => pattern.test(text))) {
      matchedRules.push({
        id: rule.id,
        level: rule.level,
        reason: rule.reason
      });
    }
  }

  const level = matchedRules.reduce<RiskLevel>(
    (highest, rule) => (riskRank[rule.level] > riskRank[highest] ? rule.level : highest),
    "low"
  );

  return {
    level,
    reasons: dedupe(matchedRules.map((rule) => rule.reason)),
    matchedRules
  };
}

function proposalToSearchText(proposal: Proposal): string {
  return [
    proposal.goal,
    proposal.context,
    proposal.proposedChanges,
    proposal.filesExpectedToChange.join("\n"),
    proposal.riskAssessment.areas.join("\n"),
    proposal.testPlan,
    proposal.commandsToRun.join("\n"),
    proposal.requestedAction,
    proposal.rollbackPlan,
    proposal.openQuestions.join("\n")
  ].join("\n");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
