import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { loadCodePmConfig } from "../../config/config-loader.js";
import type { CodePmGitHubAdapterMode } from "../../config/config-schema.js";
import { isDecision } from "../../domain/decision.js";
import type { RequestedAction } from "../../domain/actions.js";
import type { Decision, Proposal, RiskLevel } from "../../domain/types.js";
import {
  executeGitPush,
  type GitPushExecutionResult
} from "../../execution/adapters/git-push-adapter.js";
import {
  executeGitHubCreatePullRequest,
  executeGitHubCreatePullRequestAsync,
  executeGitHubMergePullRequest,
  executeGitHubMergePullRequestAsync,
  type GitHubPrExecutionResult
} from "../../execution/adapters/github-pr-adapter.js";
import {
  runExecutionPreflight,
  type ExecutionPreflightResult
} from "../../execution/execution-preflight.js";
import type { ExecutionScope } from "../../execution/execution-scope.js";
import { readGitState } from "../../integrations/git/git-reader.js";
import { realGitPushRunner } from "../../integrations/git/git-writer.js";
import {
  createGitHubRestMutationAdapter,
  type GitHubRestMutationAdapter
} from "../../integrations/github/github-rest-mutation-adapter.js";
import { createGitHubRestReadAdapter } from "../../integrations/github/github-rest-read-adapter.js";
import type {
  GitHubMutationAdapter,
  GitHubMutationResult
} from "../../integrations/github/github-mutation-port.js";
import type { GitHubPullRequestState } from "../../integrations/github/github-types.js";
import { parseProposalMarkdown } from "../../parser/proposal-parser.js";
import {
  APPROVAL_EVIDENCE_SCHEMA_VERSION,
  type ApprovalEvidence
} from "../../policy/approval-evidence.js";

export interface ExecuteActionCommandResult {
  exitCode: number;
  output: string;
}

type ExecutableAction = "push_branch" | "create_pr" | "merge_pr";
type MergeMethod = "merge" | "squash" | "rebase";
type GitHubMutationAdapterMode = "fixture" | "github";

interface ExecuteActionOptions {
  action?: ExecutableAction;
  decisionPath?: string;
  riskLevel?: RiskLevel;
  approvalPath?: string;
  scopePath?: string;
  configPath?: string;
  auditLogPath?: string;
  json: boolean;
  cwd?: string;
  remote?: string;
  branch?: string;
  force: boolean;
  baseRef?: string;
  proposalPath?: string;
  repo?: string;
  headRef?: string;
  title?: string;
  bodyPath?: string;
  expectedHeadSha?: string;
  githubResultPath?: string;
  githubMutationAdapterMode: GitHubMutationAdapterMode;
  invalidGithubMutationAdapterMode?: string;
  githubTokenEnv?: string;
  hasGithubTokenEnvFlag: boolean;
  githubAllowedRepos: string[];
  githubApiBaseUrl?: string;
  hasGithubApiBaseUrlFlag: boolean;
  githubApiVersion?: string;
  hasGithubApiVersionFlag: boolean;
  statePath?: string;
  prNumber?: number;
  requiredCheckNames: string[];
  mergeMethod?: MergeMethod;
}

interface PreparedExecution {
  action: ExecutableAction;
  riskLevel: RiskLevel;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
  currentScope: ExecutionScope;
  testEvidence?: string;
  now?: string;
  execute(preflight: ExecutionPreflightResult): ExecutionResult;
}

interface PreparedAsyncExecution
  extends Omit<PreparedExecution, "execute"> {
  execute(preflight: ExecutionPreflightResult): Promise<ExecutionResult>;
}

type ExecutionResult = GitPushExecutionResult | GitHubPrExecutionResult;

const usage = [
  "Usage: codepm execute-action --action <push_branch|create_pr|merge_pr> --decision <decision.json> --risk <low|medium|high> [--approval <approval.json> | --scope <reviewed-scope.json>] [--config <path>] [--audit-log <path>] [--github-mutation-adapter <fixture|github>] [--json]",
  "",
  "Action inputs:",
  "  push_branch: --remote <name> --branch <name> [--cwd <path>] [--base-ref <ref>] [--force]",
  "  create_pr fixture: --proposal <proposal.md> --repo <owner/name> --base-ref <ref> --head-ref <ref> --title <title> --body <file> [--expected-head-sha <sha>] --github-result <fixture.json>",
  "  create_pr github: --proposal <proposal.md> --repo <owner/name> --base-ref <ref> --head-ref <ref> --title <title> --body <file> --expected-head-sha <sha> --github-token-env <ENV> --github-allowed-repo <owner/name>",
  "  merge_pr fixture: --proposal <proposal.md> --state <pr-state.json> --expected-head-sha <sha> [--required-check <name>] [--merge-method <merge|squash|rebase>] --github-result <fixture.json>",
  "  merge_pr github: --proposal <proposal.md> --repo <owner/name> --pr <number> --expected-head-sha <sha> --required-check <name> --approval <approval.json> --github-token-env <ENV> --github-allowed-repo <owner/name>"
].join("\n");

export function runExecuteActionCommand(
  args: string[]
): ExecuteActionCommandResult {
  const options = parseExecuteActionOptions(args);
  const missingCommon = getMissingCommonOptions(options);

  if (missingCommon.length > 0) {
    return {
      exitCode: 1,
      output: `Missing required execute-action options: ${missingCommon.join(", ")}.\n\n${usage}`
    };
  }

  const adapterFlagError = validateGithubMutationAdapterFlag(options);

  if (adapterFlagError) {
    return {
      exitCode: 1,
      output: adapterFlagError
    };
  }

  if (options.githubMutationAdapterMode === "github") {
    return {
      exitCode: 1,
      output:
        "GitHub mutation adapter github requires the async execute-action path. Use the codepm CLI entrypoint or runCliAsync."
    };
  }

  const fixtureModeError = validateFixtureModeGithubFlags(options);

  if (fixtureModeError) {
    return {
      exitCode: 1,
      output: fixtureModeError
    };
  }

  const commonOptions = options as RequiredCommonOptions;
  const configCwd = getConfigCwd(commonOptions);
  const configResult = loadCodePmConfig({
    cwd: configCwd,
    configPath: options.configPath
  });

  if (!configResult.ok) {
    return {
      exitCode: 1,
      output: formatConfigErrors(configResult.configPath, configResult.errors)
    };
  }

  const effectiveAuditLogPath = getEffectiveAuditLogPath({
    options,
    configPath: configResult.configPath,
    configCwd,
    configAuditLogPath: configResult.config.defaults.auditLogPath
  });
  const effectiveOptions: RequiredCommonOptions = {
    ...commonOptions,
    auditLogPath: effectiveAuditLogPath
  };
  const prepared = prepareExecution(
    effectiveOptions,
    configResult.config.github.adapterMode
  );

  if (!prepared.ok) {
    return {
      exitCode: 1,
      output: prepared.message
    };
  }

  const preflight = runExecutionPreflight({
    decision: prepared.execution.decision,
    approvedAction: prepared.execution.action,
    requestedAction: prepared.execution.action,
    riskLevel: prepared.execution.riskLevel,
    reviewedScope: prepared.execution.reviewedScope,
    currentScope: prepared.execution.currentScope,
    approval: prepared.execution.approval,
    now: prepared.execution.now,
    auditLogPath: effectiveAuditLogPath,
    testEvidence: prepared.execution.testEvidence
  });
  const execution = prepared.execution.execute(preflight);
  const output = formatExecutionOutput({
    action: prepared.execution.action,
    preflight,
    execution,
    auditLogPath: effectiveAuditLogPath,
    json: options.json
  });

  return {
    exitCode: execution.ok ? 0 : 1,
    output
  };
}

export async function runExecuteActionCommandAsync(
  args: string[]
): Promise<ExecuteActionCommandResult> {
  const options = parseExecuteActionOptions(args);
  const missingCommon = getMissingCommonOptions(options);

  if (missingCommon.length > 0) {
    return {
      exitCode: 1,
      output: `Missing required execute-action options: ${missingCommon.join(", ")}.\n\n${usage}`
    };
  }

  const adapterFlagError = validateGithubMutationAdapterFlag(options);

  if (adapterFlagError) {
    return {
      exitCode: 1,
      output: adapterFlagError
    };
  }

  if (options.githubMutationAdapterMode === "fixture") {
    return runExecuteActionCommand(args);
  }

  const commonOptions = options as RequiredCommonOptions;
  const configCwd = getConfigCwd(commonOptions);
  const configResult = loadCodePmConfig({
    cwd: configCwd,
    configPath: options.configPath
  });

  if (!configResult.ok) {
    return {
      exitCode: 1,
      output: formatConfigErrors(configResult.configPath, configResult.errors)
    };
  }

  const effectiveAuditLogPath = getEffectiveAuditLogPath({
    options,
    configPath: configResult.configPath,
    configCwd,
    configAuditLogPath: configResult.config.defaults.auditLogPath
  });
  const effectiveOptions: RequiredCommonOptions = {
    ...commonOptions,
    auditLogPath: effectiveAuditLogPath
  };
  const githubModeError = validateGithubModeOptions(effectiveOptions);

  if (githubModeError) {
    return {
      exitCode: 1,
      output: githubModeError
    };
  }

  const prepared = await prepareExecutionAsync(effectiveOptions);

  if (!prepared.ok) {
    return {
      exitCode: 1,
      output: prepared.message
    };
  }

  const preflight = runExecutionPreflight({
    decision: prepared.execution.decision,
    approvedAction: prepared.execution.action,
    requestedAction: prepared.execution.action,
    riskLevel: prepared.execution.riskLevel,
    reviewedScope: prepared.execution.reviewedScope,
    currentScope: prepared.execution.currentScope,
    approval: prepared.execution.approval,
    now: prepared.execution.now,
    auditLogPath: effectiveAuditLogPath,
    testEvidence: prepared.execution.testEvidence
  });
  const execution = await prepared.execution.execute(preflight);
  const output = formatExecutionOutput({
    action: prepared.execution.action,
    preflight,
    execution,
    auditLogPath: effectiveAuditLogPath,
    json: options.json
  });

  return {
    exitCode: execution.ok ? 0 : 1,
    output
  };
}

type RequiredCommonOptions = ExecuteActionOptions & {
  action: ExecutableAction;
  decisionPath: string;
  riskLevel: RiskLevel;
};

function parseExecuteActionOptions(args: string[]): ExecuteActionOptions {
  const options: ExecuteActionOptions = {
    json: false,
    force: false,
    githubMutationAdapterMode: "fixture",
    hasGithubTokenEnvFlag: false,
    githubAllowedRepos: [],
    hasGithubApiBaseUrlFlag: false,
    hasGithubApiVersionFlag: false,
    requiredCheckNames: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--action") {
      options.action = parseExecutableAction(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--decision") {
      options.decisionPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--risk") {
      options.riskLevel = parseRiskLevel(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--approval") {
      options.approvalPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--scope") {
      options.scopePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--config") {
      options.configPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--audit-log") {
      options.auditLogPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--cwd") {
      options.cwd = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--remote") {
      options.remote = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--branch") {
      options.branch = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--base-ref") {
      options.baseRef = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--proposal") {
      options.proposalPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      options.repo = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--head-ref") {
      options.headRef = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--title") {
      options.title = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--body") {
      options.bodyPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--expected-head-sha") {
      options.expectedHeadSha = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--github-result") {
      options.githubResultPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--github-mutation-adapter") {
      const adapterMode = args[index + 1];

      if (adapterMode === "fixture" || adapterMode === "github") {
        options.githubMutationAdapterMode = adapterMode;
      } else {
        options.invalidGithubMutationAdapterMode = adapterMode ?? "";
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

    if (arg === "--github-allowed-repo") {
      const repo = args[index + 1];

      if (repo) {
        options.githubAllowedRepos.push(repo);
      }

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

    if (arg === "--state") {
      options.statePath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--pr") {
      options.prNumber = parsePositiveInteger(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--required-check") {
      const requiredCheck = args[index + 1];

      if (requiredCheck) {
        options.requiredCheckNames.push(requiredCheck);
      }

      index += 1;
      continue;
    }

    if (arg === "--merge-method") {
      options.mergeMethod = parseMergeMethod(args[index + 1]);
      index += 1;
    }
  }

  return options;
}

function getMissingCommonOptions(options: ExecuteActionOptions): string[] {
  const missing: string[] = [];

  if (!options.action) {
    missing.push("--action");
  }

  if (!options.decisionPath) {
    missing.push("--decision");
  }

  if (!options.riskLevel) {
    missing.push("--risk");
  }

  return missing;
}

function validateGithubMutationAdapterFlag(
  options: ExecuteActionOptions
): string | undefined {
  if (options.invalidGithubMutationAdapterMode !== undefined) {
    return `Invalid GitHub mutation adapter: ${options.invalidGithubMutationAdapterMode}. Expected fixture or github.`;
  }

  return undefined;
}

function validateFixtureModeGithubFlags(
  options: ExecuteActionOptions
): string | undefined {
  if (options.githubMutationAdapterMode !== "fixture") {
    return undefined;
  }

  if (options.hasGithubTokenEnvFlag) {
    return "--github-token-env can only be used with --github-mutation-adapter github.";
  }

  if (options.githubAllowedRepos.length > 0) {
    return "--github-allowed-repo can only be used with --github-mutation-adapter github.";
  }

  if (options.hasGithubApiBaseUrlFlag) {
    return "--github-api-base-url can only be used with --github-mutation-adapter github.";
  }

  if (options.hasGithubApiVersionFlag) {
    return "--github-api-version can only be used with --github-mutation-adapter github.";
  }

  return undefined;
}

function validateGithubModeOptions(
  options: RequiredCommonOptions
): string | undefined {
  if (options.action === "push_branch") {
    return "--github-mutation-adapter github can only be used with create_pr or merge_pr.";
  }

  if (options.githubResultPath) {
    return "--github-result cannot be used with --github-mutation-adapter github.";
  }

  if (!options.githubTokenEnv) {
    return "GitHub mutation adapter github requires --github-token-env <ENV_NAME>.";
  }

  if (!getGithubToken(options)) {
    return `Missing GitHub token. Set ${options.githubTokenEnv}.`;
  }

  if (options.githubAllowedRepos.length === 0) {
    return "GitHub mutation adapter github requires at least one --github-allowed-repo <owner/name>.";
  }

  if (options.repo && !options.githubAllowedRepos.includes(options.repo)) {
    return `GitHub mutation target ${options.repo} is not in --github-allowed-repo.`;
  }

  if (options.action === "create_pr" && !options.expectedHeadSha) {
    return "GitHub create_pr mode requires --expected-head-sha.";
  }

  if (options.action === "merge_pr") {
    if (!options.approvalPath) {
      return "GitHub merge_pr mode requires --approval <approval.json>.";
    }

    if (options.requiredCheckNames.length === 0) {
      return "GitHub merge_pr mode requires at least one --required-check <name>.";
    }

    if (options.statePath) {
      return "--state cannot be used with --github-mutation-adapter github.";
    }
  }

  return undefined;
}

function getGithubToken(options: ExecuteActionOptions): string | undefined {
  if (!options.githubTokenEnv) {
    return undefined;
  }

  const value = process.env[options.githubTokenEnv];
  return value && value.trim().length > 0 ? value : undefined;
}

function getConfigCwd(options: RequiredCommonOptions): string {
  if (options.action === "push_branch") {
    return resolve(options.cwd ?? process.cwd());
  }

  return process.cwd();
}

function getEffectiveAuditLogPath(input: {
  options: ExecuteActionOptions;
  configPath: string | null;
  configCwd: string;
  configAuditLogPath: string;
}): string {
  if (input.options.auditLogPath) {
    return input.options.auditLogPath;
  }

  if (isAbsolute(input.configAuditLogPath)) {
    return input.configAuditLogPath;
  }

  const configDir = input.configPath ? dirname(input.configPath) : input.configCwd;
  return resolve(configDir, input.configAuditLogPath);
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

function prepareExecution(
  options: RequiredCommonOptions,
  githubAdapterMode: CodePmGitHubAdapterMode
): { ok: true; execution: PreparedExecution } | { ok: false; message: string } {
  const decision = readDecisionFile(options.decisionPath);

  if (!decision.ok) {
    return {
      ok: false,
      message: `Invalid decision JSON. ${decision.error}`
    };
  }

  const approval = options.approvalPath
    ? readApprovalFile(options.approvalPath)
    : undefined;

  if (approval && !approval.ok) {
    return {
      ok: false,
      message: `Invalid approval JSON. ${approval.error}`
    };
  }

  const reviewedScope = approval?.ok
    ? ({ ok: true, scope: approval.approval.scope } as const)
    : readReviewedScope(options.scopePath);

  if (!reviewedScope.ok) {
    return {
      ok: false,
      message: reviewedScope.message
    };
  }

  if (options.action === "push_branch") {
    return preparePushBranchExecution({
      options,
      decision: decision.decision,
      approval: approval?.ok ? approval.approval : undefined,
      reviewedScope: reviewedScope.scope
    });
  }

  if (options.action === "create_pr") {
    return prepareCreatePullRequestExecution({
      options,
      decision: decision.decision,
      approval: approval?.ok ? approval.approval : undefined,
      reviewedScope: reviewedScope.scope,
      githubAdapterMode
    });
  }

  return prepareMergePullRequestExecution({
    options,
    decision: decision.decision,
    approval: approval?.ok ? approval.approval : undefined,
    reviewedScope: reviewedScope.scope,
    githubAdapterMode
  });
}

async function prepareExecutionAsync(
  options: RequiredCommonOptions
): Promise<
  { ok: true; execution: PreparedAsyncExecution } | { ok: false; message: string }
> {
  const decision = readDecisionFile(options.decisionPath);

  if (!decision.ok) {
    return {
      ok: false,
      message: `Invalid decision JSON. ${decision.error}`
    };
  }

  const approval = options.approvalPath
    ? readApprovalFile(options.approvalPath)
    : undefined;

  if (approval && !approval.ok) {
    return {
      ok: false,
      message: `Invalid approval JSON. ${approval.error}`
    };
  }

  const reviewedScope = approval?.ok
    ? ({ ok: true, scope: approval.approval.scope } as const)
    : readReviewedScope(options.scopePath);

  if (!reviewedScope.ok) {
    return {
      ok: false,
      message: reviewedScope.message
    };
  }

  if (options.action === "create_pr") {
    return prepareCreatePullRequestGitHubExecution({
      options,
      decision: decision.decision,
      approval: approval?.ok ? approval.approval : undefined,
      reviewedScope: reviewedScope.scope
    });
  }

  if (options.action === "merge_pr") {
    return prepareMergePullRequestGitHubExecution({
      options,
      decision: decision.decision,
      approval: approval?.ok ? approval.approval : undefined,
      reviewedScope: reviewedScope.scope
    });
  }

  return {
    ok: false,
    message: "--github-mutation-adapter github can only be used with create_pr or merge_pr."
  };
}

function getFixtureGitHubResultPath(
  options: RequiredCommonOptions,
  githubAdapterMode: CodePmGitHubAdapterMode,
  action: "create_pr" | "merge_pr"
): { ok: true; path: string } | { ok: false; message: string } {
  if (githubAdapterMode === "fixture" && options.githubResultPath) {
    return {
      ok: true,
      path: options.githubResultPath
    };
  }

  return {
    ok: false,
    message: `GitHub fixture adapter mode requires --github-result <fixture.json> for ${action}.\n\n${usage}`
  };
}

function preparePushBranchExecution(input: {
  options: RequiredCommonOptions;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
}): { ok: true; execution: PreparedExecution } | { ok: false; message: string } {
  const missing = getMissingSpecificOptions(input.options, [
    ["remote", "--remote"],
    ["branch", "--branch"]
  ]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing push_branch options: ${missing.join(", ")}.\n\n${usage}`
    };
  }

  const cwd = resolve(input.options.cwd ?? process.cwd());
  const remote = input.options.remote ?? "";
  const branch = input.options.branch ?? "";
  const gitResult = readGitState({
    cwd,
    baseRef: input.options.baseRef
  });

  if (!gitResult.ok) {
    return {
      ok: false,
      message: `Unable to read local git state. ${gitResult.error.message}`
    };
  }

  const headResult = realGitPushRunner.readHeadSha(cwd);

  if (!headResult.ok) {
    return {
      ok: false,
      message: `Unable to read current HEAD. ${headResult.message}`
    };
  }

  const currentScope: ExecutionScope = {
    remote,
    branch,
    expectedHeadSha: headResult.headSha,
    forcePush: input.options.force ? true : undefined,
    filesChanged: gitResult.state.changedFiles
  };

  return {
    ok: true,
    execution: {
      action: "push_branch",
      riskLevel: input.options.riskLevel,
      decision: input.decision,
      approval: input.approval,
      reviewedScope: input.reviewedScope,
      currentScope,
      execute: (preflight) =>
        executeGitPush({
          cwd,
          remote,
          branch,
          preflight,
          force: input.options.force,
          approval: input.approval,
          gitState: gitResult.state,
          secretScanBaseRef: input.options.baseRef,
          auditLogPath: input.options.auditLogPath
        })
    }
  };
}

function prepareCreatePullRequestExecution(input: {
  options: RequiredCommonOptions;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
  githubAdapterMode: CodePmGitHubAdapterMode;
}): { ok: true; execution: PreparedExecution } | { ok: false; message: string } {
  const missing = getMissingSpecificOptions(input.options, [
    ["proposalPath", "--proposal"],
    ["repo", "--repo"],
    ["baseRef", "--base-ref"],
    ["headRef", "--head-ref"],
    ["title", "--title"],
    ["bodyPath", "--body"]
  ]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing create_pr options: ${missing.join(", ")}.\n\n${usage}`
    };
  }

  const proposalPath = input.options.proposalPath ?? "";
  const repo = input.options.repo ?? "";
  const baseRef = input.options.baseRef ?? "";
  const headRef = input.options.headRef ?? "";
  const title = input.options.title ?? "";
  const bodyPath = input.options.bodyPath ?? "";
  const githubResultPath = getFixtureGitHubResultPath(
    input.options,
    input.githubAdapterMode,
    "create_pr"
  );

  if (!githubResultPath.ok) {
    return {
      ok: false,
      message: githubResultPath.message
    };
  }

  const proposal = readProposalFile(proposalPath);

  if (!proposal.ok) {
    return {
      ok: false,
      message: proposal.message
    };
  }

  const body = readTextFile(bodyPath, "PR body");

  if (!body.ok) {
    return {
      ok: false,
      message: body.message
    };
  }

  const githubResult = readGitHubMutationResult(
    githubResultPath.path,
    "create_pr"
  );

  if (!githubResult.ok) {
    return {
      ok: false,
      message: githubResult.message
    };
  }

  const adapter = createFixtureGitHubMutationAdapter(githubResult.result);
  const currentScope: ExecutionScope = {
    repo,
    branch: headRef,
    expectedHeadSha: input.options.expectedHeadSha,
    filesChanged: proposal.proposal.filesExpectedToChange
  };

  return {
    ok: true,
    execution: {
      action: "create_pr",
      riskLevel: input.options.riskLevel,
      decision: input.decision,
      approval: input.approval,
      reviewedScope: input.reviewedScope,
      currentScope,
      testEvidence: proposal.proposal.testPlan,
      execute: (preflight) =>
        executeGitHubCreatePullRequest({
          adapter,
          preflight,
          proposal: proposal.proposal,
          repo,
          baseRef,
          headRef,
          title,
          body: body.text,
          expectedHeadSha: input.options.expectedHeadSha,
          auditLogPath: input.options.auditLogPath
        })
    }
  };
}

function prepareCreatePullRequestGitHubExecution(input: {
  options: RequiredCommonOptions;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
}): { ok: true; execution: PreparedAsyncExecution } | { ok: false; message: string } {
  const missing = getMissingSpecificOptions(input.options, [
    ["proposalPath", "--proposal"],
    ["repo", "--repo"],
    ["baseRef", "--base-ref"],
    ["headRef", "--head-ref"],
    ["title", "--title"],
    ["bodyPath", "--body"],
    ["expectedHeadSha", "--expected-head-sha"]
  ]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing create_pr options: ${missing.join(", ")}.\n\n${usage}`
    };
  }

  const proposalPath = input.options.proposalPath ?? "";
  const repo = input.options.repo ?? "";
  const baseRef = input.options.baseRef ?? "";
  const headRef = input.options.headRef ?? "";
  const title = input.options.title ?? "";
  const bodyPath = input.options.bodyPath ?? "";
  const expectedHeadSha = input.options.expectedHeadSha ?? "";
  const token = getGithubToken(input.options) ?? "";
  const proposal = readProposalFile(proposalPath);

  if (!proposal.ok) {
    return {
      ok: false,
      message: proposal.message
    };
  }

  const body = readTextFile(bodyPath, "PR body");

  if (!body.ok) {
    return {
      ok: false,
      message: body.message
    };
  }

  const adapter = createGithubRestMutationAdapterForOptions(input.options, token);
  const currentScope: ExecutionScope = {
    repo,
    branch: headRef,
    expectedHeadSha,
    filesChanged: proposal.proposal.filesExpectedToChange
  };

  return {
    ok: true,
    execution: {
      action: "create_pr",
      riskLevel: input.options.riskLevel,
      decision: input.decision,
      approval: input.approval,
      reviewedScope: input.reviewedScope,
      currentScope,
      testEvidence: proposal.proposal.testPlan,
      execute: (preflight) =>
        executeGitHubCreatePullRequestAsync({
          adapter,
          preflight,
          proposal: proposal.proposal,
          repo,
          baseRef,
          headRef,
          title,
          body: body.text,
          expectedHeadSha,
          auditLogPath: input.options.auditLogPath
        })
    }
  };
}

function prepareMergePullRequestExecution(input: {
  options: RequiredCommonOptions;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
  githubAdapterMode: CodePmGitHubAdapterMode;
}): { ok: true; execution: PreparedExecution } | { ok: false; message: string } {
  const missing = getMissingSpecificOptions(input.options, [
    ["proposalPath", "--proposal"],
    ["statePath", "--state"],
    ["expectedHeadSha", "--expected-head-sha"]
  ]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing merge_pr options: ${missing.join(", ")}.\n\n${usage}`
    };
  }

  const proposalPath = input.options.proposalPath ?? "";
  const statePath = input.options.statePath ?? "";
  const expectedHeadSha = input.options.expectedHeadSha ?? "";
  const githubResultPath = getFixtureGitHubResultPath(
    input.options,
    input.githubAdapterMode,
    "merge_pr"
  );

  if (!githubResultPath.ok) {
    return {
      ok: false,
      message: githubResultPath.message
    };
  }

  const proposal = readProposalFile(proposalPath);

  if (!proposal.ok) {
    return {
      ok: false,
      message: proposal.message
    };
  }

  const prState = readPullRequestStateFile(statePath);

  if (!prState.ok) {
    return {
      ok: false,
      message: prState.message
    };
  }

  const githubResult = readGitHubMutationResult(
    githubResultPath.path,
    "merge_pr"
  );

  if (!githubResult.ok) {
    return {
      ok: false,
      message: githubResult.message
    };
  }

  const adapter = createFixtureGitHubMutationAdapter(githubResult.result);
  const currentScope: ExecutionScope = {
    repo: prState.state.repo,
    branch: prState.state.headRef,
    prNumber: prState.state.prNumber,
    expectedHeadSha: prState.state.headSha,
    filesChanged: prState.state.changedFiles
  };

  return {
    ok: true,
    execution: {
      action: "merge_pr",
      riskLevel: input.options.riskLevel,
      decision: input.decision,
      approval: input.approval,
      reviewedScope: input.reviewedScope,
      currentScope,
      now: prState.state.readAt,
      testEvidence: proposal.proposal.testPlan,
      execute: (preflight) =>
        executeGitHubMergePullRequest({
          adapter,
          preflight,
          proposal: proposal.proposal,
          prState: prState.state,
          expectedHeadSha,
          requiredCheckNames: input.options.requiredCheckNames,
          mergeMethod: input.options.mergeMethod,
          auditLogPath: input.options.auditLogPath,
          now: prState.state.readAt
        })
    }
  };
}

async function prepareMergePullRequestGitHubExecution(input: {
  options: RequiredCommonOptions;
  decision: Decision;
  approval?: ApprovalEvidence;
  reviewedScope: ExecutionScope;
}): Promise<
  { ok: true; execution: PreparedAsyncExecution } | { ok: false; message: string }
> {
  const missing = getMissingSpecificOptions(input.options, [
    ["proposalPath", "--proposal"],
    ["repo", "--repo"],
    ["prNumber", "--pr"],
    ["expectedHeadSha", "--expected-head-sha"]
  ]);

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing merge_pr options: ${missing.join(", ")}.\n\n${usage}`
    };
  }

  const proposalPath = input.options.proposalPath ?? "";
  const repo = input.options.repo ?? "";
  const prNumber = input.options.prNumber ?? 0;
  const expectedHeadSha = input.options.expectedHeadSha ?? "";
  const token = getGithubToken(input.options) ?? "";
  const proposal = readProposalFile(proposalPath);

  if (!proposal.ok) {
    return {
      ok: false,
      message: proposal.message
    };
  }

  const readAdapter = createGithubRestReadAdapterForOptions(input.options, token);
  const initialRead = await readAdapter.readPullRequest({ repo, prNumber });

  if (!initialRead.ok) {
    return {
      ok: false,
      message: `Unable to read GitHub PR state. ${initialRead.error.message}`
    };
  }

  const mutationAdapter = createGithubRestMutationAdapterForOptions(
    input.options,
    token
  );
  const currentScope: ExecutionScope = {
    repo: initialRead.state.repo,
    branch: initialRead.state.headRef,
    prNumber: initialRead.state.prNumber,
    expectedHeadSha: initialRead.state.headSha,
    filesChanged: initialRead.state.changedFiles
  };

  return {
    ok: true,
    execution: {
      action: "merge_pr",
      riskLevel: input.options.riskLevel,
      decision: input.decision,
      approval: input.approval,
      reviewedScope: input.reviewedScope,
      currentScope,
      now: initialRead.state.readAt,
      testEvidence: proposal.proposal.testPlan,
      execute: async (preflight) => {
        const freshRead = await readAdapter.readPullRequest({ repo, prNumber });

        if (!freshRead.ok) {
          return executeGitHubMergePullRequestAsync({
            adapter: createFailingRestMutationAdapter(
              "merge_pr",
              `Unable to refresh GitHub PR state. ${freshRead.error.message}`
            ),
            preflight,
            proposal: proposal.proposal,
            prState: initialRead.state,
            expectedHeadSha,
            requiredCheckNames: input.options.requiredCheckNames,
            mergeMethod: input.options.mergeMethod,
            auditLogPath: input.options.auditLogPath,
            now: initialRead.state.readAt
          });
        }

        return executeGitHubMergePullRequestAsync({
          adapter: mutationAdapter,
          preflight,
          proposal: proposal.proposal,
          prState: freshRead.state,
          expectedHeadSha,
          requiredCheckNames: input.options.requiredCheckNames,
          mergeMethod: input.options.mergeMethod,
          auditLogPath: input.options.auditLogPath,
          now: freshRead.state.readAt
        });
      }
    }
  };
}

function createGithubRestMutationAdapterForOptions(
  options: RequiredCommonOptions,
  token: string
): GitHubRestMutationAdapter {
  return createGitHubRestMutationAdapter({
    token,
    allowedRepos: options.githubAllowedRepos,
    ...(options.githubApiBaseUrl ? { apiBaseUrl: options.githubApiBaseUrl } : {}),
    ...(options.githubApiVersion ? { apiVersion: options.githubApiVersion } : {})
  });
}

function createGithubRestReadAdapterForOptions(
  options: RequiredCommonOptions,
  token: string
) {
  return createGitHubRestReadAdapter({
    token,
    ...(options.githubApiBaseUrl ? { apiBaseUrl: options.githubApiBaseUrl } : {}),
    ...(options.githubApiVersion ? { apiVersion: options.githubApiVersion } : {})
  });
}

function createFailingRestMutationAdapter(
  action: "create_pr" | "merge_pr",
  message: string
): GitHubRestMutationAdapter {
  return {
    async createPullRequest() {
      return {
        ok: false,
        action: "create_pr",
        code: "adapter_error",
        message
      };
    },
    async mergePullRequest() {
      return {
        ok: false,
        action,
        code: "adapter_error",
        message
      };
    }
  };
}

function readDecisionFile(
  path: string
): { ok: true; decision: Decision } | { ok: false; error: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseDecisionJson(value);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read file."
    };
  }
}

function parseDecisionJson(
  value: unknown
): { ok: true; decision: Decision } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Expected an object." };
  }

  if (value.schemaVersion !== "codepm.decision.v1") {
    return {
      ok: false,
      error: "Expected schemaVersion codepm.decision.v1."
    };
  }

  if (!isDecisionPayload(value.decision)) {
    return {
      ok: false,
      error: "Expected a valid decision payload."
    };
  }

  return {
    ok: true,
    decision: value.decision
  };
}

function readApprovalFile(
  path: string
): { ok: true; approval: ApprovalEvidence } | { ok: false; error: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;

    if (!isApprovalEvidence(value)) {
      return {
        ok: false,
        error: `Expected schemaVersion ${APPROVAL_EVIDENCE_SCHEMA_VERSION} with a valid approval scope.`
      };
    }

    return {
      ok: true,
      approval: value
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not read file."
    };
  }
}

function readReviewedScope(
  scopePath: string | undefined
): { ok: true; scope: ExecutionScope } | { ok: false; message: string } {
  if (!scopePath) {
    return {
      ok: false,
      message:
        "Missing reviewed scope. Provide --scope <reviewed-scope.json> when --approval is not supplied."
    };
  }

  try {
    const value = JSON.parse(readFileSync(scopePath, "utf8")) as unknown;

    if (!isExecutionScope(value)) {
      return {
        ok: false,
        message:
          "Invalid reviewed scope JSON. Expected an object with filesChanged."
      };
    }

    return {
      ok: true,
      scope: value
    };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid reviewed scope JSON. ${getErrorMessage(error)}`
    };
  }
}

function readProposalFile(
  path: string
): { ok: true; proposal: Proposal } | { ok: false; message: string } {
  const markdown = readTextFile(path, "proposal");

  if (!markdown.ok) {
    return markdown;
  }

  const parsed = parseProposalMarkdown(markdown.text);

  if (!parsed.ok) {
    return {
      ok: false,
      message: `Invalid proposal Markdown. ${parsed.errors.map((error) => error.message).join(" ")}`
    };
  }

  return {
    ok: true,
    proposal: parsed.proposal
  };
}

function readPullRequestStateFile(
  path: string
): { ok: true; state: GitHubPullRequestState } | { ok: false; message: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;

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
  } catch (error) {
    return {
      ok: false,
      message: `Invalid GitHub state fixture. ${getErrorMessage(error)}`
    };
  }
}

function readGitHubMutationResult(
  path: string,
  expectedAction: ExecutableAction
):
  | { ok: true; result: GitHubMutationResult }
  | { ok: false; message: string } {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;

    if (!isGitHubMutationResult(value)) {
      return {
        ok: false,
        message:
          "Invalid GitHub mutation result fixture. Expected a GitHubMutationResult object."
      };
    }

    if (value.action !== expectedAction) {
      return {
        ok: false,
        message: `GitHub mutation fixture action is ${value.action}, not ${expectedAction}.`
      };
    }

    return {
      ok: true,
      result: value
    };
  } catch (error) {
    return {
      ok: false,
      message: `Invalid GitHub mutation result fixture. ${getErrorMessage(error)}`
    };
  }
}

function readTextFile(
  path: string,
  label: string
): { ok: true; text: string } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      text: readFileSync(path, "utf8")
    };
  } catch (error) {
    return {
      ok: false,
      message: `Unable to read ${label} file. ${getErrorMessage(error)}`
    };
  }
}

function createFixtureGitHubMutationAdapter(
  result: GitHubMutationResult
): GitHubMutationAdapter {
  return {
    createPullRequest() {
      return result.action === "create_pr"
        ? result
        : {
            ok: false,
            action: "create_pr",
            code: "adapter_error",
            message: "Fixture result is not a create_pr mutation."
          };
    },
    mergePullRequest() {
      return result.action === "merge_pr"
        ? result
        : {
            ok: false,
            action: "merge_pr",
            code: "adapter_error",
            message: "Fixture result is not a merge_pr mutation."
          };
    }
  };
}

function formatExecutionOutput(input: {
  action: ExecutableAction;
  preflight: ExecutionPreflightResult;
  execution: ExecutionResult;
  auditLogPath?: string;
  json: boolean;
}): string {
  if (input.json) {
    return JSON.stringify(toJsonExecutionOutput(input), null, 2);
  }

  return formatMarkdownExecutionOutput(input);
}

function formatMarkdownExecutionOutput(input: {
  action: ExecutableAction;
  preflight: ExecutionPreflightResult;
  execution: ExecutionResult;
  auditLogPath?: string;
}): string {
  const lines = [
    "# CodePM Execution Result",
    "",
    `Action: ${input.action}`,
    `Preflight Status: ${input.preflight.status}`,
    `Execution Status: ${input.execution.status}`,
    "",
    "## Preflight Result",
    `- Status: ${input.preflight.status}`,
    `- Approval Required: ${input.preflight.approvalRequired ? "yes" : "no"}`,
    "",
    "## Execution Result",
    `- Status: ${input.execution.status}`,
    ...formatExecutionMetadata(input.execution),
    "",
    "## Findings",
    ...formatFindings(input.preflight, input.execution),
    "",
    "## Audit",
    input.auditLogPath ? `- ${input.auditLogPath}` : "- Not requested."
  ];

  return redactSecrets(lines.join("\n"));
}

function toJsonExecutionOutput(input: {
  action: ExecutableAction;
  preflight: ExecutionPreflightResult;
  execution: ExecutionResult;
  auditLogPath?: string;
}): Record<string, unknown> {
  return {
    schemaVersion: "codepm.execution.v1",
    action: input.action,
    preflight: {
      ok: input.preflight.ok,
      status: input.preflight.status,
      approvalRequired: input.preflight.approvalRequired,
      findings: input.preflight.ok ? [] : input.preflight.findings
    },
    execution: {
      ok: input.execution.ok,
      status: input.execution.status,
      findings: input.execution.findings,
      ...toExecutionMetadata(input.execution)
    },
    findings: [
      ...(input.preflight.ok
        ? []
        : input.preflight.findings.map((finding) => ({
            source: "preflight",
            ...finding
          }))),
      ...input.execution.findings.map((finding) => ({
        source: "execution",
        ...finding
      }))
    ],
    auditLogPath: input.auditLogPath
  };
}

function formatExecutionMetadata(execution: ExecutionResult): string[] {
  const metadata = toExecutionMetadata(execution);

  return Object.entries(metadata).map(
    ([key, value]) => `- ${key}: ${formatMetadataValue(value)}`
  );
}

function toExecutionMetadata(execution: ExecutionResult): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if ("command" in execution && execution.command) {
    metadata.command = execution.command.join(" ");
  }

  if ("finalHeadSha" in execution && execution.finalHeadSha) {
    metadata.finalHeadSha = execution.finalHeadSha;
  }

  if ("url" in execution && execution.url) {
    metadata.url = execution.url;
  }

  if ("mutation" in execution && execution.mutation) {
    metadata.mutation = execution.mutation;
  }

  return metadata;
}

function formatFindings(
  preflight: ExecutionPreflightResult,
  execution: ExecutionResult
): string[] {
  const findings = [
    ...(preflight.ok
      ? []
      : preflight.findings.map((finding) => ({
          source: "preflight",
          code: finding.code,
          message: finding.message
        }))),
    ...execution.findings.map((finding) => ({
      source: "execution",
      code: finding.code,
      message: finding.message
    }))
  ];

  if (findings.length === 0) {
    return ["- None."];
  }

  return findings.map(
    (finding) => `- ${finding.source}.${finding.code}: ${finding.message}`
  );
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function getMissingSpecificOptions(
  options: ExecuteActionOptions,
  keys: Array<[keyof ExecuteActionOptions, string]>
): string[] {
  return keys
    .filter(([key]) => {
      const value = options[key];
      return typeof value === "string" ? value.length === 0 : !value;
    })
    .map(([, flag]) => flag);
}

function parseExecutableAction(value: string | undefined): ExecutableAction | undefined {
  if (
    value === "push_branch" ||
    value === "create_pr" ||
    value === "merge_pr"
  ) {
    return value;
  }

  return undefined;
}

function parseRiskLevel(value: string | undefined): RiskLevel | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  return undefined;
}

function parseMergeMethod(value: string | undefined): MergeMethod | undefined {
  if (value === "merge" || value === "squash" || value === "rebase") {
    return value;
  }

  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }

  return parsed;
}

function isDecisionPayload(value: unknown): value is Decision {
  if (!isRecord(value) || !isDecision(value.decision)) {
    return false;
  }

  return (
    typeof value.summary === "string" &&
    isStringArray(value.requiredChanges) &&
    isStringArray(value.risks) &&
    isStringArray(value.verificationRequired) &&
    isStringArray(value.approvedActions) &&
    isStringArray(value.blockedActions)
  );
}

function isApprovalEvidence(value: unknown): value is ApprovalEvidence {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schemaVersion === APPROVAL_EVIDENCE_SCHEMA_VERSION &&
    typeof value.approver === "string" &&
    typeof value.approvedAt === "string" &&
    typeof value.expiresAt === "string" &&
    isSupportedRequestedAction(value.requestedAction) &&
    parseRiskLevel(value.riskLevel as string | undefined) !== undefined &&
    isExecutionScope(value.scope)
  );
}

function isExecutionScope(value: unknown): value is ExecutionScope {
  if (!isRecord(value) || !isStringArray(value.filesChanged)) {
    return false;
  }

  return (
    isOptionalString(value.repo) &&
    isOptionalString(value.remote) &&
    isOptionalString(value.branch) &&
    isOptionalNumber(value.prNumber) &&
    isOptionalString(value.expectedHeadSha) &&
    isOptionalBoolean(value.forcePush)
  );
}

function isGitHubPullRequestState(value: unknown): value is GitHubPullRequestState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.repo === "string" &&
    typeof value.prNumber === "number" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.baseRef === "string" &&
    typeof value.headRef === "string" &&
    typeof value.headSha === "string" &&
    isStringArray(value.changedFiles) &&
    Array.isArray(value.checks) &&
    Array.isArray(value.reviews) &&
    Array.isArray(value.reviewThreads) &&
    Array.isArray(value.unresolvedThreads) &&
    isRecord(value.mergeability) &&
    typeof value.mergeability.state === "string" &&
    typeof value.mergeability.isDraft === "boolean" &&
    typeof value.mergeability.canMerge === "boolean" &&
    typeof value.readAt === "string"
  );
}

function isGitHubMutationResult(
  value: unknown
): value is GitHubMutationResult {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.ok === true &&
    isGitHubMutationAction(value.action) &&
    typeof value.repo === "string" &&
    typeof value.prNumber === "number" &&
    typeof value.url === "string" &&
    (value.result === "created" || value.result === "merged") &&
    typeof value.stateReadAt === "string"
  ) {
    return true;
  }

  return (
    value.ok === false &&
    isGitHubMutationAction(value.action) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isGitHubMutationAction(value: unknown): value is "create_pr" | "merge_pr" {
  return value === "create_pr" || value === "merge_pr";
}

function isSupportedRequestedAction(value: unknown): value is RequestedAction {
  return (
    value === "plan_review" ||
    value === "implementation_review" ||
    value === "push_branch" ||
    value === "create_pr" ||
    value === "merge_pr"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read file.";
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(password\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(ghp|github_pat|sk|pk)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}
