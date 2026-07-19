import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Decision } from "../domain/types.js";
import { loadCodePmConfig } from "../config/config-loader.js";
import { createFixtureGitHubReadAdapter } from "../integrations/github/github-port.js";
import type { GitHubPullRequestState } from "../integrations/github/github-types.js";
import { readGitState } from "../integrations/git/git-reader.js";
import { parseProposalMarkdown } from "../parser/proposal-parser.js";
import type {
  CodePmPluginStatus,
  CodePmPluginReviewResult
} from "../plugin/index.js";
import {
  CODEPM_PLUGIN_CAPABILITIES,
  reviewProposalForClaude,
  reviewPullRequestFromGitHubForClaude,
  reviewPullRequestForClaude
} from "../plugin/index.js";
import { formatClaudeFeedback } from "../review/claude-feedback-formatter.js";
import { buildDecision } from "../review/decision-builder.js";
import { formatDecisionMarkdown } from "../review/decision-formatter.js";
import { reviewDiff } from "../review/diff-reviewer.js";
import { reviewPlan } from "../review/plan-reviewer.js";
import {
  resolveConfigPath,
  resolveMcpPathPolicy
} from "./sandbox.js";

export const CODEPM_MCP_SCHEMA_VERSION = "codepm.mcp.v1";

export const CODEPM_MCP_TOOL_NAMES = [
  "codepm_review_proposal",
  "codepm_review_pr_fixture",
  "codepm_review_pr_github",
  "codepm_review_diff",
  "codepm_capabilities"
] as const;

export type CodePmMcpToolName = (typeof CODEPM_MCP_TOOL_NAMES)[number];

export interface ReviewProposalToolInput {
  proposalMarkdown: string;
}

export interface ReviewPrFixtureToolInput {
  proposalMarkdown: string;
  prState: GitHubPullRequestState;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
}

export interface ReviewPrGitHubToolInput {
  proposalMarkdown: string;
  repo: string;
  prNumber: number;
  expectedHeadSha?: string;
  requiredCheckNames?: string[];
  tokenEnv?: string;
  apiBaseUrl?: string;
  apiVersion?: string;
}

export interface ReviewDiffToolInput {
  proposalMarkdown: string;
  cwd: string;
  baseRef?: string;
  configPath?: string;
}

export interface CodePmMcpCapabilities {
  schemaVersion: typeof CODEPM_MCP_SCHEMA_VERSION;
  plugin: typeof CODEPM_PLUGIN_CAPABILITIES;
  tools: readonly CodePmMcpToolName[];
  supportsExecutionMutation: false;
  supportsLocalDiffReview: true;
  supportsRealGitHubPullRequestReview: true;
  safety: {
    reviewOnly: true;
    exposesExternalGitHubRead: true;
    exposesBrowserFallback: false;
    exposesGitPush: false;
    exposesGitHubMutation: false;
    requiresAllowedRootsForLocalDiffReview: true;
  };
}

export function runReviewProposalTool(
  input: ReviewProposalToolInput
): CodePmPluginReviewResult {
  return reviewProposalForClaude(input);
}

export async function runReviewPrFixtureTool(
  input: ReviewPrFixtureToolInput
): Promise<CodePmPluginReviewResult> {
  const githubAdapter = createFixtureGitHubReadAdapter([input.prState]);

  return reviewPullRequestForClaude({
    proposalMarkdown: input.proposalMarkdown,
    locator: {
      repo: input.prState.repo,
      prNumber: input.prState.prNumber
    },
    githubAdapter,
    expectedHeadSha: input.expectedHeadSha,
    requiredCheckNames: input.requiredCheckNames
  });
}

export async function runReviewPrGitHubTool(
  input: ReviewPrGitHubToolInput
): Promise<CodePmPluginReviewResult> {
  return reviewPullRequestFromGitHubForClaude({
    proposalMarkdown: input.proposalMarkdown,
    locator: {
      repo: input.repo,
      prNumber: input.prNumber
    },
    expectedHeadSha: input.expectedHeadSha,
    requiredCheckNames: input.requiredCheckNames,
    tokenEnv: input.tokenEnv,
    apiBaseUrl: input.apiBaseUrl,
    apiVersion: input.apiVersion
  });
}

export function runReviewDiffTool(
  input: ReviewDiffToolInput
): CodePmPluginReviewResult {
  const cwdPolicy = resolveMcpPathPolicy(input.cwd);

  if (!cwdPolicy.ok) {
    return toPluginResult(buildDeniedPathDecision("cwd", cwdPolicy), "adapter_error");
  }

  const effectiveConfigPath = resolveConfigPath(
    cwdPolicy.resolvedPath,
    input.configPath
  );

  if (effectiveConfigPath) {
    const configPolicy = resolveMcpPathPolicy(effectiveConfigPath);

    if (!configPolicy.ok) {
      return toPluginResult(
        buildDeniedPathDecision("configPath", configPolicy),
        "adapter_error"
      );
    }
  }

  const configResult = loadCodePmConfig({
    cwd: cwdPolicy.resolvedPath,
    configPath: effectiveConfigPath
  });

  if (!configResult.ok) {
    return toPluginResult(buildInvalidConfigDecision(configResult), "adapter_error");
  }

  const parseResult = parseProposalMarkdown(input.proposalMarkdown);

  if (!parseResult.ok) {
    return toPluginResult(reviewPlan({ parseResult }));
  }

  const gitResult = readGitState({
    cwd: cwdPolicy.resolvedPath,
    baseRef: input.baseRef ?? configResult.config.defaults.baseRef
  });

  if (!gitResult.ok) {
    return toPluginResult(
      buildGitReadFailureDecision(cwdPolicy.resolvedPath, gitResult.error.message),
      "adapter_error"
    );
  }

  return toPluginResult(
    reviewDiff({
      proposal: parseResult.proposal,
      gitState: gitResult.state,
      maxChangedFiles: configResult.config.review.maxChangedFiles,
      additionalSensitivePaths:
        configResult.config.review.additionalSensitivePaths
    })
  );
}

export function getCodePmMcpCapabilities(): CodePmMcpCapabilities {
  return {
    schemaVersion: CODEPM_MCP_SCHEMA_VERSION,
    plugin: CODEPM_PLUGIN_CAPABILITIES,
    tools: CODEPM_MCP_TOOL_NAMES,
    supportsExecutionMutation: false,
    supportsLocalDiffReview: true,
    supportsRealGitHubPullRequestReview: true,
    safety: {
      reviewOnly: true,
      exposesExternalGitHubRead: true,
      exposesBrowserFallback: false,
      exposesGitPush: false,
      exposesGitHubMutation: false,
      requiresAllowedRootsForLocalDiffReview: true
    }
  };
}

export function toReviewToolResult(
  result: CodePmPluginReviewResult
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: result.feedbackMarkdown
      }
    ],
    structuredContent: result as unknown as Record<string, unknown>
  };
}

export function toCapabilitiesToolResult(
  capabilities: CodePmMcpCapabilities
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(capabilities, null, 2)
      }
    ],
    structuredContent: capabilities as unknown as Record<string, unknown>
  };
}

function toPluginResult(
  decision: Decision,
  status: CodePmPluginStatus = decision.decision
): CodePmPluginReviewResult {
  return {
    schemaVersion: "codepm.plugin.v1",
    ok: decision.decision === "approve" && status === "approve",
    status,
    decision,
    decisionMarkdown: formatDecisionMarkdown(decision),
    feedbackMarkdown: formatClaudeFeedback(decision)
  };
}

function buildDeniedPathDecision(
  field: "cwd" | "configPath",
  policy: { resolvedPath: string; allowedRoots: string[] }
): Decision {
  return buildDecision({
    decision: "block",
    summary: `MCP review-diff ${field} is outside CODEPM_MCP_ALLOWED_ROOTS.`,
    requiredChanges: [
      `Use a ${field} under an allowed root or update CODEPM_MCP_ALLOWED_ROOTS.`
    ],
    risks: [
      `MCP local diff review attempted to read outside allowed roots: ${policy.resolvedPath}.`
    ],
    verificationRequired: [
      `Allowed roots: ${policy.allowedRoots.join(", ") || "(none)"}.`
    ],
    blockedActions: [
      "Do not use MCP review-diff for this path.",
      "Do not push, create a PR, or merge from this result."
    ]
  });
}

function buildInvalidConfigDecision(
  result: Extract<ReturnType<typeof loadCodePmConfig>, { ok: false }>
): Decision {
  return buildDecision({
    decision: "block",
    summary: `Invalid CodePM config at ${result.configPath}.`,
    requiredChanges: result.errors.map(
      (error) => `${error.path}: ${error.message}`
    ),
    risks: ["CodePM project config could not be verified."],
    verificationRequired: [
      "Fix the CodePM config and re-run MCP review-diff."
    ],
    blockedActions: [
      "Do not push, create a PR, or merge until config is valid."
    ]
  });
}

function buildGitReadFailureDecision(cwd: string, message: string): Decision {
  return buildDecision({
    decision: "block",
    summary: message,
    requiredChanges: [`Run MCP review-diff with a git work tree cwd: ${cwd}.`],
    risks: ["Local git state could not be verified."],
    verificationRequired: ["Re-run MCP review-diff from the target repository."],
    blockedActions: [
      "Do not push the branch.",
      "Do not create a PR.",
      "Do not merge the PR."
    ]
  });
}
