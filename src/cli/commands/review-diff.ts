import { readFileSync } from "node:fs";

import type { AuditEntry, Decision, Proposal } from "../../domain/types.js";
import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import { loadCodePmConfig } from "../../config/config-loader.js";
import type { GitState } from "../../integrations/git/git-types.js";
import { readGitState } from "../../integrations/git/git-reader.js";
import { parseProposalMarkdown, type ProposalParseResult } from "../../parser/proposal-parser.js";
import { classifyRisk } from "../../policy/risk-classifier.js";
import { formatClaudeFeedback } from "../../review/claude-feedback-formatter.js";
import {
  formatDecisionJson,
  formatDecisionMarkdown
} from "../../review/decision-formatter.js";
import { buildDecision } from "../../review/decision-builder.js";
import { reviewDiff } from "../../review/diff-reviewer.js";
import { reviewPlan } from "../../review/plan-reviewer.js";

export interface ReviewDiffCommandResult {
  exitCode: number;
  output: string;
}

interface ReviewDiffOptions {
  proposalPath?: string;
  baseRef?: string;
  configPath?: string;
  json: boolean;
  feedbackForClaude: boolean;
  auditLogPath?: string;
}

export function runReviewDiffCommand(args: string[]): ReviewDiffCommandResult {
  const options = parseReviewDiffOptions(args);

  if (!options.proposalPath) {
    return {
      exitCode: 1,
      output:
        "Missing proposal path.\n\nUsage: codepm review-diff --proposal <proposal.md> [--base-ref <ref>] [--config <path>] [--json] [--feedback-for-claude] [--audit-log <path>]"
    };
  }

  const configResult = loadCodePmConfig({
    cwd: process.cwd(),
    configPath: options.configPath
  });

  if (!configResult.ok) {
    return {
      exitCode: 1,
      output: formatConfigErrors(configResult.configPath, configResult.errors)
    };
  }

  const effectiveBaseRef = options.baseRef ?? configResult.config.defaults.baseRef;
  const markdown = readFileSync(options.proposalPath, "utf8");
  const parseResult = parseProposalMarkdown(markdown);

  if (!parseResult.ok) {
    const decision = reviewPlan({ parseResult });
    return {
      exitCode: 1,
      output: formatReviewDiffOutput(decision, options)
    };
  }

  const gitResult = readGitState({
    cwd: process.cwd(),
    baseRef: effectiveBaseRef
  });

  if (!gitResult.ok) {
    const decision = buildDecision({
      decision: "block",
      summary: gitResult.error.message,
      requiredChanges: ["Run review-diff inside a git work tree."],
      verificationRequired: ["Re-run review-diff from the target repository."],
      blockedActions: [
        "Do not push the branch.",
        "Do not create a PR.",
        "Do not merge the PR."
      ]
    });

    appendAuditIfRequested(options, parseResult.proposal, undefined, decision);

    return {
      exitCode: 1,
      output: formatReviewDiffOutput(decision, options)
    };
  }

  const decision = reviewDiff({
    proposal: parseResult.proposal,
    gitState: gitResult.state,
    maxChangedFiles: configResult.config.review.maxChangedFiles,
    additionalSensitivePaths:
      configResult.config.review.additionalSensitivePaths
  });

  appendAuditIfRequested(options, parseResult.proposal, gitResult.state, decision);

  return {
    exitCode: decision.decision === "approve" ? 0 : 1,
    output: formatReviewDiffOutput(decision, options)
  };
}

function parseReviewDiffOptions(args: string[]): ReviewDiffOptions {
  const options: ReviewDiffOptions = {
    json: false,
    feedbackForClaude: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--proposal") {
      options.proposalPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--base-ref") {
      options.baseRef = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--config") {
      options.configPath = args[index + 1];
      index += 1;
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
    }
  }

  return options;
}

function formatConfigErrors(
  configPath: string,
  errors: Array<{ path: string; message: string }>
): string {
  return [
    `Invalid CodePM config at ${configPath}`,
    "",
    ...errors.map((error) => `- ${error.path}: ${error.message}`)
  ].join("\n");
}

function formatReviewDiffOutput(
  decision: Decision,
  options: ReviewDiffOptions
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
  options: ReviewDiffOptions,
  proposal: Proposal,
  gitState: GitState | undefined,
  decision: Decision
): void {
  if (!options.auditLogPath) {
    return;
  }

  appendAuditEntry(
    options.auditLogPath,
    createReviewDiffAuditEntry(proposal, gitState, decision)
  );
}

function createReviewDiffAuditEntry(
  proposal: Proposal,
  gitState: GitState | undefined,
  decision: Decision
): AuditEntry {
  const riskLevel = classifyRisk(proposal).level;

  return createAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: "implementation_review",
    decision: decision.decision,
    reason: decision.summary,
    filesChanged: gitState?.changedFiles ?? proposal.filesExpectedToChange,
    riskLevel,
    testEvidence: proposal.testPlan,
    github: null,
    humanApprovalRequired: decision.decision === "block" || riskLevel === "high",
    humanApprovalGranted: null
  });
}
