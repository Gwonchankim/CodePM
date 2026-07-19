import type { Decision, Proposal } from "../domain/types.js";
import type { GitHubPullRequestState } from "../integrations/github/github-types.js";
import { buildDecision } from "./decision-builder.js";
import {
  evaluateGitHubPullRequestState,
  type PullRequestGateFinding
} from "./github-state-evaluator.js";

export interface PullRequestGateReviewInput {
  proposal: Proposal;
  prState: GitHubPullRequestState;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
  requireApprovedReview?: boolean;
}

export function reviewPullRequestGate(
  input: PullRequestGateReviewInput
): Decision {
  if (input.proposal.requestedAction === "create_pr") {
    const metadataChanges = evaluatePrCreationMetadata(input);

    if (metadataChanges.length > 0) {
      return buildDecision({
        decision: "request_changes",
        summary: "The PR metadata needs corrections before creation approval.",
        requiredChanges: metadataChanges,
        verificationRequired: [
          "Update the PR title and body to match the proposal, test plan, and rollback plan."
        ],
        approvedActions: ["Revise the PR metadata."],
        blockedActions: ["Do not create the PR until metadata is corrected."]
      });
    }

    return buildDecision({
      decision: "approve",
      summary: "The PR creation metadata matches the proposal.",
      verificationRequired: [
        "Re-check the proposed PR title and body immediately before creation."
      ],
      approvedActions: ["Proceed to execution preflight for create_pr."],
      blockedActions: [
        "Do not create the PR if title, body, branch, or reviewed scope changes before execution."
      ]
    });
  }

  const findings = evaluateGitHubPullRequestState(input);

  if (findings.some((finding) => finding.severity === "block")) {
    return buildDecision({
      decision: "block",
      summary: "The GitHub PR is not ready for the requested action.",
      requiredChanges: findings.map((finding) => finding.message),
      risks: findings.map((finding) => finding.message),
      verificationRequired: [
        "Resolve all GitHub PR gate findings and re-run PR review.",
        "Re-check the PR head SHA immediately before execution."
      ],
      approvedActions: ["Revise the PR or wait for checks to complete."],
      blockedActions: blockedActionsFor(input.proposal.requestedAction)
    });
  }

  return buildDecision({
    decision: "approve",
    summary: `The GitHub PR is merge-ready for ${input.proposal.requestedAction}.`,
    verificationRequired: [
      "Re-check GitHub PR state before executing any mutation.",
      "Confirm the PR head SHA still matches the reviewed state."
    ],
    approvedActions: [
      `Proceed to execution preflight for ${input.proposal.requestedAction}.`
    ],
    blockedActions: [
      "Do not merge if the PR head SHA changes before execution.",
      "Do not bypass required checks, reviews, or unresolved thread gates."
    ]
  });
}

function evaluatePrCreationMetadata(
  input: PullRequestGateReviewInput
): string[] {
  const requiredChanges: string[] = [];

  if (input.prState.title.trim().length === 0) {
    requiredChanges.push("Add a PR title that describes the proposal goal.");
  }

  const body = input.prState.body.toLowerCase();
  if (
    input.prState.body.trim().length === 0 ||
    !body.includes(input.proposal.testPlan.toLowerCase()) ||
    !body.includes(input.proposal.rollbackPlan.toLowerCase())
  ) {
    requiredChanges.push(
      "Add a PR body that includes the test plan and rollback plan."
    );
  }

  return requiredChanges;
}

function blockedActionsFor(requestedAction: Proposal["requestedAction"]): string[] {
  if (requestedAction === "merge_pr") {
    return ["Do not merge the PR."];
  }

  if (requestedAction === "create_pr") {
    return ["Do not create the PR."];
  }

  if (requestedAction === "push_branch") {
    return ["Do not push the branch."];
  }

  return ["Do not proceed with the requested action."];
}
