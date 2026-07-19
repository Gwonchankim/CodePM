import { readFileSync } from "node:fs";

import type { AuditEntry, Decision, Proposal, RiskLevel } from "../../domain/types.js";
import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import { parseProposalMarkdown, type ProposalParseResult } from "../../parser/proposal-parser.js";
import { classifyRisk } from "../../policy/risk-classifier.js";
import { formatClaudeFeedback } from "../../review/claude-feedback-formatter.js";
import {
  formatDecisionJson,
  formatDecisionMarkdown
} from "../../review/decision-formatter.js";
import { reviewPlan } from "../../review/plan-reviewer.js";

export interface ReviewPlanCommandResult {
  exitCode: number;
  output: string;
}

interface ReviewPlanOptions {
  proposalPath?: string;
  json: boolean;
  feedbackForClaude: boolean;
  auditLogPath?: string;
}

export function runReviewPlanCommand(args: string[]): ReviewPlanCommandResult {
  const options = parseReviewPlanOptions(args);

  if (!options.proposalPath) {
    return {
      exitCode: 1,
      output: "Missing proposal path.\n\nUsage: codepm review-plan <proposal.md> [--json] [--feedback-for-claude] [--audit-log <path>]"
    };
  }

  const markdown = readFileSync(options.proposalPath, "utf8");
  const parseResult = parseProposalMarkdown(markdown);
  const decision = reviewPlan({ parseResult });

  if (options.auditLogPath) {
    appendAuditEntry(
      options.auditLogPath,
      createReviewPlanAuditEntry(parseResult, decision)
    );
  }

  return {
    exitCode: decision.decision === "approve" ? 0 : 1,
    output: formatReviewPlanOutput(decision, options)
  };
}

function parseReviewPlanOptions(args: string[]): ReviewPlanOptions {
  const options: ReviewPlanOptions = {
    json: false,
    feedbackForClaude: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--feedback-for-claude") {
      options.feedbackForClaude = true;
      continue;
    }

    if (arg === "--audit-log") {
      options.auditLogPath = args[index + 1];
      index += 1;
      continue;
    }

    if (!arg.startsWith("-") && !options.proposalPath) {
      options.proposalPath = arg;
    }
  }

  return options;
}

function formatReviewPlanOutput(
  decision: Decision,
  options: ReviewPlanOptions
): string {
  if (options.feedbackForClaude) {
    return formatClaudeFeedback(decision);
  }

  if (options.json) {
    return formatDecisionJson(decision);
  }

  return formatDecisionMarkdown(decision);
}

function createReviewPlanAuditEntry(
  parseResult: ProposalParseResult,
  decision: Decision
): AuditEntry {
  const proposal = parseResult.ok ? parseResult.proposal : undefined;
  const riskLevel = proposal ? classifyRisk(proposal).level : "low";

  return createAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: proposal?.requestedAction ?? "plan_review",
    decision: decision.decision,
    reason: decision.summary,
    filesChanged: proposal?.filesExpectedToChange ?? [],
    riskLevel,
    testEvidence: getTestEvidence(proposal),
    github: null,
    humanApprovalRequired: decision.decision === "block" || riskLevel === "high",
    humanApprovalGranted: null
  });
}

function getTestEvidence(proposal: Proposal | undefined): string {
  if (!proposal) {
    return "No test evidence; proposal did not parse.";
  }

  return proposal.testPlan;
}
