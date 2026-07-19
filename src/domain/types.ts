import type { RequestedAction } from "./actions.js";
import type { DecisionValue } from "./decision.js";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  areas: string[];
}

export interface MatchedRiskRule {
  id: string;
  level: RiskLevel;
  reason: string;
}

export interface RiskResult {
  level: RiskLevel;
  reasons: string[];
  matchedRules: MatchedRiskRule[];
}

export interface Proposal {
  goal: string;
  context: string;
  proposedChanges: string;
  filesExpectedToChange: string[];
  riskAssessment: RiskAssessment;
  testPlan: string;
  commandsToRun: string[];
  requestedAction: RequestedAction;
  rollbackPlan: string;
  openQuestions: string[];
}

export interface ActionRequest {
  requestedAction: RequestedAction;
  source: "proposal" | "diff" | "claude_cli" | "github";
  repo?: string;
  branch?: string;
  prNumber?: number;
  expectedHeadSha?: string;
}

export interface Decision {
  decision: DecisionValue;
  summary: string;
  requiredChanges: string[];
  risks: string[];
  verificationRequired: string[];
  approvedActions: string[];
  blockedActions: string[];
}

export interface ClaudeFeedback {
  decision: DecisionValue;
  summary: string;
  requiredChanges: string[];
  evidenceToProvideNext: string[];
  approvedActions: string[];
  blockedActions: string[];
}

export interface AuditEntry {
  timestamp: string;
  actor: string;
  requestedAction: RequestedAction;
  decision: DecisionValue;
  reason: string;
  filesChanged: string[];
  riskLevel: RiskLevel;
  testEvidence: string;
  github: Record<string, unknown> | null;
  humanApprovalRequired: boolean;
  humanApprovalGranted: boolean | null;
}
