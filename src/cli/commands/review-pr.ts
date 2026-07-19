import { readFileSync } from "node:fs";

import { appendAuditEntry, createAuditEntry } from "../../audit/audit-writer.js";
import { loadCodePmConfig } from "../../config/config-loader.js";
import type { CodePmConfig } from "../../config/config-schema.js";
import type { AuditEntry, Decision, Proposal } from "../../domain/types.js";
import { createGitHubRestReadAdapter } from "../../integrations/github/github-rest-read-adapter.js";
import type { GitHubPullRequestState } from "../../integrations/github/github-types.js";
import { parseProposalMarkdown } from "../../parser/proposal-parser.js";
import { classifyRisk } from "../../policy/risk-classifier.js";
import { formatClaudeFeedback } from "../../review/claude-feedback-formatter.js";
import { buildDecision } from "../../review/decision-builder.js";
import {
  formatDecisionJson,
  formatDecisionMarkdown
} from "../../review/decision-formatter.js";
import { reviewPlan } from "../../review/plan-reviewer.js";
import { reviewPullRequestGate } from "../../review/pr-gate-reviewer.js";

export interface ReviewPrCommandResult {
  exitCode: number;
  output: string;
}

type ReviewPrAdapterMode = "fixture" | "github";

interface ReviewPrOptions {
  adapterMode: ReviewPrAdapterMode;
  hasAdapterModeFlag: boolean;
  invalidAdapterMode?: string;
  proposalPath?: string;
  statePath?: string;
  repo?: string;
  prNumber?: number;
  expectedHeadSha?: string;
  requiredCheckNames: string[];
  configPath?: string;
  githubTokenEnv?: string;
  githubApiBaseUrl?: string;
  githubApiVersion?: string;
  hasGithubTokenEnvFlag: boolean;
  hasGithubApiBaseUrlFlag: boolean;
  hasGithubApiVersionFlag: boolean;
  json: boolean;
  feedbackForClaude: boolean;
  auditLogPath?: string;
}

const DEFAULT_GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

export function runReviewPrCommand(args: string[]): ReviewPrCommandResult {
  const parsedOptions = parseReviewPrOptions(args);
  const configResult = loadCodePmConfig({
    cwd: process.cwd(),
    configPath: parsedOptions.configPath
  });

  if (!configResult.ok) {
    return {
      exitCode: 1,
      output: formatConfigErrors(configResult.configPath, configResult.errors)
    };
  }

  const options = applyReviewPrConfig(parsedOptions, configResult.config);
  const validationError = validateReviewPrOptions(options);

  if (validationError) {
    return {
      exitCode: 1,
      output: validationError
    };
  }

  if (options.adapterMode === "github") {
    return {
      exitCode: 1,
      output:
        "The GitHub review-pr adapter is asynchronous. Use runCliAsync or the codepm CLI entrypoint for --adapter github."
    };
  }

  const proposalResult = readAndReviewProposal(options);

  if (!proposalResult.ok) {
    return proposalResult.result;
  }

  const stateResult = readFixtureState(options.statePath ?? "");

  if (!stateResult.ok) {
    return {
      exitCode: 1,
      output: stateResult.message
    };
  }

  const matchError = validateStateMatchesLocator(options, stateResult.state);

  if (matchError) {
    return {
      exitCode: 1,
      output: matchError
    };
  }

  return reviewStateAndFormat(options, proposalResult.proposal, stateResult.state);
}

export async function runReviewPrCommandAsync(
  args: string[]
): Promise<ReviewPrCommandResult> {
  const parsedOptions = parseReviewPrOptions(args);
  const configResult = loadCodePmConfig({
    cwd: process.cwd(),
    configPath: parsedOptions.configPath
  });

  if (!configResult.ok) {
    return {
      exitCode: 1,
      output: formatConfigErrors(configResult.configPath, configResult.errors)
    };
  }

  const options = applyReviewPrConfig(parsedOptions, configResult.config);
  const validationError = validateReviewPrOptions(options);

  if (validationError) {
    return {
      exitCode: 1,
      output: validationError
    };
  }

  const proposalResult = readAndReviewProposal(options);

  if (!proposalResult.ok) {
    return proposalResult.result;
  }

  if (options.adapterMode === "fixture") {
    const stateResult = readFixtureState(options.statePath ?? "");

    if (!stateResult.ok) {
      return {
        exitCode: 1,
        output: stateResult.message
      };
    }

    const matchError = validateStateMatchesLocator(options, stateResult.state);

    if (matchError) {
      return {
        exitCode: 1,
        output: matchError
      };
    }

    return reviewStateAndFormat(options, proposalResult.proposal, stateResult.state);
  }

  const stateResult = await readGitHubState(options);

  if (!stateResult.ok) {
    const decision = buildGitHubReadFailureDecision(stateResult.message);

    return {
      exitCode: 1,
      output: formatReviewPrOutput(decision, options)
    };
  }

  return reviewStateAndFormat(options, proposalResult.proposal, stateResult.state);
}

function usage(): string {
  return "Usage: codepm review-pr --proposal <proposal.md> --repo <owner/name> --pr <number> [--adapter <fixture|github>] [--state <github-state.json>] [--config <path>] [--github-token-env <ENV_NAME>] [--github-api-base-url <url>] [--github-api-version <version>] [--expected-head-sha <sha>] [--required-check <name>] [--json] [--feedback-for-claude] [--audit-log <path>]";
}

function applyReviewPrConfig(
  options: ReviewPrOptions,
  config: CodePmConfig
): ReviewPrOptions {
  return {
    ...options,
    adapterMode: options.hasAdapterModeFlag
      ? options.adapterMode
      : config.github.prReadAdapterMode,
    githubTokenEnv: options.hasGithubTokenEnvFlag
      ? options.githubTokenEnv
      : config.github.prReadTokenEnv,
    githubApiBaseUrl: options.hasGithubApiBaseUrlFlag
      ? options.githubApiBaseUrl
      : config.github.prReadApiBaseUrl,
    githubApiVersion: options.hasGithubApiVersionFlag
      ? options.githubApiVersion
      : config.github.prReadApiVersion
  };
}

function validateReviewPrOptions(options: ReviewPrOptions): string | undefined {
  if (options.invalidAdapterMode) {
    return `Invalid review-pr adapter: ${options.invalidAdapterMode}. Expected fixture or github.\n\n${usage()}`;
  }

  if (!options.proposalPath) {
    return `Missing proposal path.\n\n${usage()}`;
  }

  if (!options.repo) {
    return `Missing GitHub repo.\n\n${usage()}`;
  }

  if (!options.prNumber) {
    return `Missing GitHub PR number.\n\n${usage()}`;
  }

  if (options.adapterMode === "fixture") {
    const githubOnlyFlag = firstGithubOnlyFlag(options);

    if (githubOnlyFlag) {
      return `${githubOnlyFlag} can only be used with --adapter github.`;
    }

    if (!options.statePath) {
      return "No GitHub read adapter configured. Provide --state <github-state.json> to run review-pr in fixture mode.";
    }

    return undefined;
  }

  if (options.statePath) {
    return "--state cannot be used with --adapter github. GitHub mode reads PR state from the GitHub API.";
  }

  const tokenEnvName = options.githubTokenEnv ?? DEFAULT_GITHUB_TOKEN_ENV;
  const token = process.env[tokenEnvName];

  if (!token || token.trim().length === 0) {
    return `Missing GitHub token. Set ${tokenEnvName} or pass --github-token-env <ENV_NAME> for --adapter github.`;
  }

  return undefined;
}

function firstGithubOnlyFlag(options: ReviewPrOptions): string | undefined {
  if (options.hasGithubTokenEnvFlag) {
    return "--github-token-env";
  }

  if (options.hasGithubApiBaseUrlFlag) {
    return "--github-api-base-url";
  }

  if (options.hasGithubApiVersionFlag) {
    return "--github-api-version";
  }

  return undefined;
}

function readAndReviewProposal(
  options: ReviewPrOptions
):
  | { ok: true; proposal: Proposal }
  | { ok: false; result: ReviewPrCommandResult } {
  const markdown = readFileSync(options.proposalPath ?? "", "utf8");
  const parseResult = parseProposalMarkdown(markdown);

  if (!parseResult.ok) {
    const decision = reviewPlan({ parseResult });

    return {
      ok: false,
      result: {
        exitCode: 1,
        output: formatReviewPrOutput(decision, options)
      }
    };
  }

  return {
    ok: true,
    proposal: parseResult.proposal
  };
}

async function readGitHubState(
  options: ReviewPrOptions
): Promise<
  | { ok: true; state: GitHubPullRequestState }
  | { ok: false; message: string }
> {
  const tokenEnvName = options.githubTokenEnv ?? DEFAULT_GITHUB_TOKEN_ENV;
  const token = process.env[tokenEnvName]?.trim();

  if (!token) {
    return {
      ok: false,
      message: `Missing GitHub token. Set ${tokenEnvName} or pass --github-token-env <ENV_NAME> for --adapter github.`
    };
  }

  const adapter = createGitHubRestReadAdapter({
    token,
    apiBaseUrl: options.githubApiBaseUrl,
    apiVersion: options.githubApiVersion
  });

  const result = await adapter.readPullRequest({
    repo: options.repo ?? "",
    prNumber: options.prNumber ?? 0
  });

  if (!result.ok) {
    return {
      ok: false,
      message: `GitHub PR state could not be read (${result.error.code}): ${result.error.message}`
    };
  }

  return {
    ok: true,
    state: result.state
  };
}

function validateStateMatchesLocator(
  options: ReviewPrOptions,
  state: GitHubPullRequestState
): string | undefined {
  if (state.repo !== options.repo || state.prNumber !== options.prNumber) {
    return `Fixture state does not match requested repo/pr. Requested ${options.repo}#${options.prNumber}, state is ${state.repo}#${state.prNumber}.`;
  }

  return undefined;
}

function reviewStateAndFormat(
  options: ReviewPrOptions,
  proposal: Proposal,
  state: GitHubPullRequestState
): ReviewPrCommandResult {
  const decision = reviewPullRequestGate({
    proposal,
    prState: state,
    expectedHeadSha: options.expectedHeadSha,
    requiredCheckNames: options.requiredCheckNames
  });

  appendAuditIfRequested(options, proposal, state, decision);

  return {
    exitCode: decision.decision === "approve" ? 0 : 1,
    output: formatReviewPrOutput(decision, options)
  };
}

function parseReviewPrOptions(args: string[]): ReviewPrOptions {
  const options: ReviewPrOptions = {
    adapterMode: "fixture",
    hasAdapterModeFlag: false,
    requiredCheckNames: [],
    hasGithubTokenEnvFlag: false,
    hasGithubApiBaseUrlFlag: false,
    hasGithubApiVersionFlag: false,
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

    if (arg === "--adapter") {
      const adapterMode = args[index + 1];
      options.hasAdapterModeFlag = true;

      if (adapterMode === "fixture" || adapterMode === "github") {
        options.adapterMode = adapterMode;
      } else {
        options.invalidAdapterMode = adapterMode ?? "";
      }

      index += 1;
      continue;
    }

    if (arg === "--config") {
      options.configPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--state") {
      options.statePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      options.repo = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--pr") {
      options.prNumber = parsePrNumber(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--expected-head-sha") {
      options.expectedHeadSha = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--required-check") {
      const requiredCheckName = args[index + 1];

      if (requiredCheckName) {
        options.requiredCheckNames.push(requiredCheckName);
      }

      index += 1;
      continue;
    }

    if (arg === "--github-token-env") {
      options.githubTokenEnv = args[index + 1];
      options.hasGithubTokenEnvFlag = true;
      index += 1;
      continue;
    }

    if (arg === "--github-api-base-url") {
      options.githubApiBaseUrl = args[index + 1];
      options.hasGithubApiBaseUrlFlag = true;
      index += 1;
      continue;
    }

    if (arg === "--github-api-version") {
      options.githubApiVersion = args[index + 1];
      options.hasGithubApiVersionFlag = true;
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

function buildGitHubReadFailureDecision(message: string): Decision {
  return buildDecision({
    decision: "block",
    summary: "GitHub PR state could not be read safely.",
    requiredChanges: [message],
    risks: [message],
    verificationRequired: [
      "Confirm the GitHub token, repository locator, PR number, and network access, then re-run PR review."
    ],
    approvedActions: ["Retry read-only PR review after fixing GitHub access."],
    blockedActions: [
      "Do not merge, push, create a PR, or use Browser fallback based on unread GitHub state."
    ]
  });
}

function parsePrNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readFixtureState(
  statePath: string
):
  | { ok: true; state: GitHubPullRequestState }
  | { ok: false; message: string } {
  const raw = readFileSync(statePath, "utf8");
  const value = JSON.parse(raw) as unknown;

  if (!isGitHubPullRequestState(value)) {
    return {
      ok: false,
      message:
        "Invalid GitHub state fixture. Expected a GitHubPullRequestState object."
    };
  }

  return {
    ok: true,
    state: value
  };
}

function isGitHubPullRequestState(value: unknown): value is GitHubPullRequestState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GitHubPullRequestState>;

  return (
    typeof candidate.repo === "string" &&
    typeof candidate.prNumber === "number" &&
    typeof candidate.title === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.baseRef === "string" &&
    typeof candidate.headRef === "string" &&
    typeof candidate.headSha === "string" &&
    Array.isArray(candidate.changedFiles) &&
    Array.isArray(candidate.checks) &&
    Array.isArray(candidate.reviews) &&
    Array.isArray(candidate.reviewThreads) &&
    Array.isArray(candidate.unresolvedThreads) &&
    !!candidate.mergeability &&
    typeof candidate.mergeability === "object" &&
    typeof candidate.mergeability.canMerge === "boolean" &&
    typeof candidate.mergeability.state === "string" &&
    typeof candidate.mergeability.isDraft === "boolean" &&
    typeof candidate.readAt === "string"
  );
}

function formatReviewPrOutput(
  decision: Decision,
  options: ReviewPrOptions
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
  options: ReviewPrOptions,
  proposal: Proposal,
  prState: GitHubPullRequestState,
  decision: Decision
): void {
  if (!options.auditLogPath) {
    return;
  }

  appendAuditEntry(
    options.auditLogPath,
    createReviewPrAuditEntry(proposal, prState, decision)
  );
}

function createReviewPrAuditEntry(
  proposal: Proposal,
  prState: GitHubPullRequestState,
  decision: Decision
): AuditEntry {
  const riskLevel = classifyRisk(proposal).level;

  return createAuditEntry({
    timestamp: new Date().toISOString(),
    actor: "codex-pm-gate",
    requestedAction: proposal.requestedAction,
    decision: decision.decision,
    reason: decision.summary,
    filesChanged: prState.changedFiles,
    riskLevel,
    testEvidence: proposal.testPlan,
    github: {
      repo: prState.repo,
      prNumber: prState.prNumber,
      baseRef: prState.baseRef,
      headRef: prState.headRef,
      headSha: prState.headSha,
      readAt: prState.readAt
    },
    humanApprovalRequired: decision.decision === "block" || riskLevel === "high",
    humanApprovalGranted: null
  });
}
