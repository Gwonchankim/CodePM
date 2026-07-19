import type { Decision } from "../domain/types.js";
import type {
  GitHubPullRequestLocator
} from "../integrations/github/github-types.js";
import type { GitHubReadAdapter } from "../integrations/github/github-port.js";
import {
  createGitHubRestReadAdapter,
  type GitHubRestFetch
} from "../integrations/github/github-rest-read-adapter.js";
import { parseProposalMarkdown } from "../parser/proposal-parser.js";
import { formatClaudeFeedback } from "../review/claude-feedback-formatter.js";
import { buildDecision } from "../review/decision-builder.js";
import { formatDecisionMarkdown } from "../review/decision-formatter.js";
import { reviewPlan } from "../review/plan-reviewer.js";
import { reviewPullRequestGate } from "../review/pr-gate-reviewer.js";

export const CODEPM_PLUGIN_SCHEMA_VERSION = "codepm.plugin.v1";

export const CODEPM_PLUGIN_CAPABILITIES = {
  schemaVersion: CODEPM_PLUGIN_SCHEMA_VERSION,
  supportsProposalReview: true,
  supportsPullRequestReview: true,
  supportsRealGitHubPullRequestReview: true,
  supportsExecutionMutation: false
} as const;

export type CodePmPluginStatus = Decision["decision"] | "adapter_error";

export interface CodePmPluginReviewResult {
  schemaVersion: typeof CODEPM_PLUGIN_SCHEMA_VERSION;
  ok: boolean;
  status: CodePmPluginStatus;
  decision: Decision;
  decisionMarkdown: string;
  feedbackMarkdown: string;
}

export interface ReviewProposalForClaudeInput {
  proposalMarkdown: string;
}

export interface ReviewPullRequestForClaudeInput {
  proposalMarkdown: string;
  locator: GitHubPullRequestLocator;
  githubAdapter: GitHubReadAdapter;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
}

export interface ReviewPullRequestFromGitHubForClaudeInput {
  proposalMarkdown: string;
  locator: GitHubPullRequestLocator;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
  tokenEnv?: string;
  apiBaseUrl?: string;
  apiVersion?: string;
  fetchImpl?: GitHubRestFetch;
}

const DEFAULT_GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

export function reviewProposalForClaude(
  input: ReviewProposalForClaudeInput
): CodePmPluginReviewResult {
  const parseResult = parseProposalMarkdown(input.proposalMarkdown);
  const decision = reviewPlan({ parseResult });

  return toPluginResult(decision);
}

export async function reviewPullRequestForClaude(
  input: ReviewPullRequestForClaudeInput
): Promise<CodePmPluginReviewResult> {
  const parseResult = parseProposalMarkdown(input.proposalMarkdown);

  if (!parseResult.ok) {
    return toPluginResult(reviewPlan({ parseResult }));
  }

  const readResult = await input.githubAdapter.readPullRequest(input.locator);

  if (!readResult.ok) {
    return toPluginResult(
      buildGitHubReadFailureDecision(input.locator, readResult.error.message),
      "adapter_error"
    );
  }

  return toPluginResult(
    reviewPullRequestGate({
      proposal: parseResult.proposal,
      prState: readResult.state,
      expectedHeadSha: input.expectedHeadSha,
      requiredCheckNames: input.requiredCheckNames
    })
  );
}

export async function reviewPullRequestFromGitHubForClaude(
  input: ReviewPullRequestFromGitHubForClaudeInput
): Promise<CodePmPluginReviewResult> {
  const tokenEnv = input.tokenEnv ?? DEFAULT_GITHUB_TOKEN_ENV;
  const token = process.env[tokenEnv]?.trim();

  if (!token) {
    return toPluginResult(
      buildGitHubReadFailureDecision(
        input.locator,
        `Missing GitHub token. Set ${tokenEnv} before reviewing live GitHub PR state.`
      ),
      "adapter_error"
    );
  }

  const githubAdapter = createGitHubRestReadAdapter({
    token,
    apiBaseUrl: input.apiBaseUrl,
    apiVersion: input.apiVersion,
    fetchImpl: input.fetchImpl
  });

  return reviewPullRequestForClaude({
    proposalMarkdown: input.proposalMarkdown,
    locator: input.locator,
    githubAdapter,
    expectedHeadSha: input.expectedHeadSha,
    requiredCheckNames: input.requiredCheckNames
  });
}

function toPluginResult(
  decision: Decision,
  status: CodePmPluginStatus = decision.decision
): CodePmPluginReviewResult {
  return {
    schemaVersion: CODEPM_PLUGIN_SCHEMA_VERSION,
    ok: decision.decision === "approve" && status === "approve",
    status,
    decision,
    decisionMarkdown: formatDecisionMarkdown(decision),
    feedbackMarkdown: formatClaudeFeedback(decision)
  };
}

function buildGitHubReadFailureDecision(
  locator: GitHubPullRequestLocator,
  message: string
): Decision {
  return buildDecision({
    decision: "block",
    summary: `Unable to read GitHub PR state for ${locator.repo}#${locator.prNumber}.`,
    requiredChanges: [`Resolve GitHub read adapter error: ${message}`],
    risks: ["GitHub PR state could not be verified."],
    verificationRequired: [
      "Re-run PR review after GitHub state can be read."
    ],
    approvedActions: ["Retry read-only PR review after fixing the adapter."],
    blockedActions: [
      "Do not push, create a PR, or merge from this plugin result."
    ]
  });
}
