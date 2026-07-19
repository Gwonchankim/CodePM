import type { Proposal, Decision, RiskLevel } from "../domain/types.js";
import type { ProposalParseResult } from "../parser/proposal-parser.js";
import { classifyRisk } from "../policy/risk-classifier.js";
import { buildDecision } from "./decision-builder.js";

export interface PlanReviewInput {
  proposal?: Proposal;
  parseResult?: ProposalParseResult;
}

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const mutationActions = new Set(["push_branch", "create_pr", "merge_pr"]);

export function reviewPlan(input: PlanReviewInput): Decision {
  const proposal = resolveProposal(input);

  if (!proposal.ok) {
    return buildDecision({
      decision: "request_changes",
      summary: "The proposal is missing required structure before PM approval.",
      requiredChanges: proposal.errors.map((error) =>
        error.code === "missing_required_section"
          ? `Add the required section: ${error.section}.`
          : error.message
      ),
      verificationRequired: ["Submit a revised Claude Work Proposal."],
      approvedActions: ["Revise the Claude Work Proposal."],
      blockedActions: [
        "Do not start implementation.",
        "Do not push, create a PR, or merge from this proposal."
      ]
    });
  }

  const risk = classifyRisk(proposal.proposal);
  const weakTestPlan = isWeakTestPlan(proposal.proposal.testPlan);
  const declaredRisk = proposal.proposal.riskAssessment.level;
  const riskUnderstated = riskRank[risk.level] > riskRank[declaredRisk];
  const highRiskMutation =
    risk.level === "high" && mutationActions.has(proposal.proposal.requestedAction);

  if (highRiskMutation) {
    return buildDecision({
      decision: "block",
      summary:
        "The proposal requests a high-risk mutating action without approval evidence.",
      requiredChanges: [
        `Provide explicit human approval evidence before requesting ${proposal.proposal.requestedAction}.`
      ],
      risks: risk.reasons,
      verificationRequired: [
        "Re-check the proposal scope and risk assessment.",
        "Provide explicit human approval evidence for the exact action."
      ],
      approvedActions: ["Revise the Claude Work Proposal."],
      blockedActions: blockedActionFor(proposal.proposal.requestedAction)
    });
  }

  const requiredChanges: string[] = [];
  if (weakTestPlan) {
    requiredChanges.push(
      "Replace the weak test plan with concrete automated or manual verification steps."
    );
  }

  if (riskUnderstated) {
    requiredChanges.push(
      `Update the Risk Assessment from ${declaredRisk} to ${risk.level} and include the matched risk reasons.`
    );
  }

  if (requiredChanges.length > 0) {
    return buildDecision({
      decision: "request_changes",
      summary: "The proposal is directionally acceptable but needs PM fixes.",
      requiredChanges,
      risks: risk.reasons,
      verificationRequired: [
        "Submit a revised Claude Work Proposal with corrected risk and verification detail."
      ],
      approvedActions: ["Revise the Claude Work Proposal."],
      blockedActions: [
        "Do not start implementation.",
        "Do not push, create a PR, or merge from this proposal."
      ]
    });
  }

  return buildDecision({
    decision: "approve",
    summary: `The plan is complete, ${risk.level} risk, and ready for implementation.`,
    risks: risk.reasons,
    verificationRequired: [
      "Run the proposed verification steps after implementation.",
      "Return for implementation review before push, PR creation, or merge."
    ],
    approvedActions: ["Proceed with implementation."],
    blockedActions: ["Do not push, create a PR, or merge from this plan alone."]
  });
}

function resolveProposal(
  input: PlanReviewInput
):
  | { ok: true; proposal: Proposal }
  | { ok: false; errors: Exclude<ProposalParseResult, { ok: true }>["errors"] } {
  if (input.proposal) {
    return { ok: true, proposal: input.proposal };
  }

  if (input.parseResult?.ok) {
    return { ok: true, proposal: input.parseResult.proposal };
  }

  return {
    ok: false,
    errors: input.parseResult?.errors ?? [
      {
        code: "missing_required_section",
        section: "Proposal",
        message: "Missing proposal input"
      }
    ]
  };
}

function isWeakTestPlan(testPlan: string): boolean {
  const normalized = testPlan.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "tbd" ||
    normalized === "none" ||
    normalized === "n/a" ||
    normalized.includes("not run")
  );
}

function blockedActionFor(requestedAction: Proposal["requestedAction"]): string[] {
  if (requestedAction === "merge_pr") {
    return ["Do not merge the PR."];
  }

  if (requestedAction === "push_branch") {
    return ["Do not push the branch."];
  }

  if (requestedAction === "create_pr") {
    return ["Do not create the PR."];
  }

  return ["Do not proceed with the requested action."];
}
