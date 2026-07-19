import type { AuditEntry, Decision, Proposal, RiskLevel } from "../../domain/types.js";
import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import type { RequestedAction } from "../../domain/actions.js";
import { readClaudeTranscript } from "../../integrations/claude-cli/transcript-reader.js";
import {
  normalizeClaudeOutput,
  type ClaudeOutputNormalizeResult
} from "../../orchestration/claude-output-normalizer.js";
import { classifyRisk } from "../../policy/risk-classifier.js";
import { formatClaudeFeedback } from "../../review/claude-feedback-formatter.js";
import {
  formatDecisionJson,
  formatDecisionMarkdown
} from "../../review/decision-formatter.js";
import { buildDecision } from "../../review/decision-builder.js";
import { reviewPlan } from "../../review/plan-reviewer.js";

export interface ReviewClaudeOutputCommandResult {
  exitCode: number;
  output: string;
}

interface ReviewClaudeOutputOptions {
  transcriptPath?: string;
  json: boolean;
  feedbackForClaude: boolean;
  auditLogPath?: string;
}

export function runReviewClaudeOutputCommand(
  args: string[]
): ReviewClaudeOutputCommandResult {
  const options = parseReviewClaudeOutputOptions(args);

  if (!options.transcriptPath) {
    return {
      exitCode: 1,
      output:
        "Missing transcript path.\n\nUsage: codepm review-claude-output <transcript.txt> [--json] [--feedback-for-claude] [--audit-log <path>]"
    };
  }

  const transcript = readClaudeTranscript(options.transcriptPath);
  const normalized = normalizeClaudeOutput(transcript);

  if (!normalized.ok) {
    const decision = createNormalizeFailureDecision(normalized);
    appendAuditIfRequested(options, undefined, "plan_review", undefined, decision);

    return {
      exitCode: 1,
      output: formatReviewClaudeOutput(decision, options)
    };
  }

  const decision = reviewPlan({ proposal: normalized.proposal });
  appendAuditIfRequested(
    options,
    normalized.proposal,
    normalized.actionRequest.requestedAction,
    normalized.testEvidence,
    decision
  );

  return {
    exitCode: decision.decision === "approve" ? 0 : 1,
    output: formatReviewClaudeOutput(decision, options)
  };
}

function parseReviewClaudeOutputOptions(args: string[]): ReviewClaudeOutputOptions {
  const options: ReviewClaudeOutputOptions = {
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

    if (!arg.startsWith("-") && !options.transcriptPath) {
      options.transcriptPath = arg;
    }
  }

  return options;
}

function createNormalizeFailureDecision(
  result: Exclude<ClaudeOutputNormalizeResult, { ok: true }>
): Decision {
  return buildDecision({
    decision: "request_changes",
    summary: "Claude output could not be normalized into a supported CodePM gate.",
    requiredChanges: result.errors.map((error) => error.message),
    verificationRequired: [
      "Resend the Claude output with exactly one codepm-proposal block.",
      "Include at most one codepm-action-request block."
    ],
    approvedActions: ["Revise the Claude output."],
    blockedActions: [
      "Do not start implementation, push, create a PR, or merge from this transcript."
    ]
  });
}

function formatReviewClaudeOutput(
  decision: Decision,
  options: ReviewClaudeOutputOptions
): string {
  if (options.feedbackForClaude) {
    return formatClaudeFeedback(decision);
  }

  if (options.json) {
    return formatDecisionJson(decision);
  }

  return formatDecisionMarkdown(decision);
}

function appendAuditIfRequested(
  options: ReviewClaudeOutputOptions,
  proposal: Proposal | undefined,
  requestedAction: RequestedAction,
  testEvidence: string | undefined,
  decision: Decision
): void {
  if (!options.auditLogPath) {
    return;
  }

  appendAuditEntry(
    options.auditLogPath,
    createReviewClaudeOutputAuditEntry(
      proposal,
      requestedAction,
      testEvidence,
      decision
    )
  );
}

function createReviewClaudeOutputAuditEntry(
  proposal: Proposal | undefined,
  requestedAction: RequestedAction,
  testEvidence: string | undefined,
  decision: Decision
): AuditEntry {
  const riskLevel: RiskLevel = proposal ? classifyRisk(proposal).level : "low";

  return createAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction,
    decision: decision.decision,
    reason: decision.summary,
    filesChanged: proposal?.filesExpectedToChange ?? [],
    riskLevel,
    testEvidence: testEvidence ?? proposal?.testPlan ?? "No test evidence parsed.",
    github: null,
    humanApprovalRequired: decision.decision === "block" || riskLevel === "high",
    humanApprovalGranted: null
  });
}
