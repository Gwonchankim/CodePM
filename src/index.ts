export { VERSION, getHelpText, runCli, runCliAsync } from "./cli/index.js";
export {
  CODEPM_CONFIG_SCHEMA_VERSION,
  DEFAULT_CODEPM_CONFIG
} from "./config/config-schema.js";
export type {
  CodePmConfig,
  CodePmConfigDefaults,
  CodePmConfigSchemaVersion,
  CodePmGitHubAdapterMode,
  CodePmGitHubConfig,
  CodePmReviewConfig,
  CodePmSafetyConfig
} from "./config/config-schema.js";
export {
  loadCodePmConfig,
  parseCodePmConfig
} from "./config/config-loader.js";
export type {
  CodePmConfigValidationError,
  CodePmConfigValidationErrorCode,
  LoadCodePmConfigOptions,
  LoadCodePmConfigResult
} from "./config/config-loader.js";
export {
  REQUESTED_ACTIONS,
  isRequestedAction
} from "./domain/actions.js";
export { DECISIONS, isDecision } from "./domain/decision.js";
export type {
  ActionRequest,
  AuditEntry,
  ClaudeFeedback,
  Decision,
  MatchedRiskRule,
  Proposal,
  RiskAssessment,
  RiskResult,
  RiskLevel
} from "./domain/types.js";
export { parseProposalMarkdown } from "./parser/proposal-parser.js";
export type {
  ProposalParseError,
  ProposalParseErrorCode,
  ProposalParseResult,
  ProposalSection
} from "./parser/proposal-parser.js";
export { classifyRisk } from "./policy/risk-classifier.js";
export {
  APPROVAL_EVIDENCE_SCHEMA_VERSION,
  isHumanApprovalRequired,
  normalizeApprovalFiles,
  normalizeApprovalPath
} from "./policy/approval-evidence.js";
export type {
  ApprovalEvidence,
  ApprovalScope
} from "./policy/approval-evidence.js";
export { validateApprovalEvidence } from "./policy/approval-validator.js";
export type {
  ApprovalValidationError,
  ApprovalValidationErrorCode,
  ApprovalValidationInput,
  ApprovalValidationResult
} from "./policy/approval-validator.js";
export { reviewPlan } from "./review/plan-reviewer.js";
export type { PlanReviewInput } from "./review/plan-reviewer.js";
export {
  formatDecisionJson,
  formatDecisionMarkdown,
  toDecisionJson
} from "./review/decision-formatter.js";
export type { DecisionJsonResult } from "./review/decision-formatter.js";
export {
  formatClaudeFeedback,
  toClaudeFeedback
} from "./review/claude-feedback-formatter.js";
export {
  appendAuditEntry,
  createAuditEntry
} from "./audit/audit-writer.js";
export type { CreateAuditEntryInput } from "./audit/audit-writer.js";
export { readClaudeTranscript } from "./integrations/claude-cli/transcript-reader.js";
export { findSensitivePathMatches } from "./policy/sensitive-paths.js";
export type {
  SensitivePathMatch,
  SensitivePathMatchOptions
} from "./policy/sensitive-paths.js";
export { redactSecrets } from "./policy/redaction.js";
export { scanSecrets } from "./policy/secret-scanner.js";
export type {
  SecretFinding,
  SecretFindingKind,
  SecretScanInput,
  SecretScanResult
} from "./policy/secret-scanner.js";
export { reviewDiff } from "./review/diff-reviewer.js";
export type { DiffReviewInput } from "./review/diff-reviewer.js";
export { evaluateGitHubPullRequestState } from "./review/github-state-evaluator.js";
export type {
  GitHubStateEvaluationInput,
  PullRequestGateFinding,
  PullRequestGateFindingSeverity
} from "./review/github-state-evaluator.js";
export { reviewPullRequestGate } from "./review/pr-gate-reviewer.js";
export type { PullRequestGateReviewInput } from "./review/pr-gate-reviewer.js";
export { normalizeClaudeOutput } from "./orchestration/claude-output-normalizer.js";
export type {
  ClaudeOutputBlock,
  ClaudeOutputBlockKind,
  ClaudeOutputNormalizeError,
  ClaudeOutputNormalizeErrorCode,
  ClaudeOutputNormalizeResult
} from "./orchestration/claude-output-normalizer.js";
export { readGitState } from "./integrations/git/git-reader.js";
export type {
  GitReadError,
  GitReadErrorCode,
  GitReadResult,
  GitState,
  ReadGitStateOptions
} from "./integrations/git/git-types.js";
export { realGitPushRunner } from "./integrations/git/git-writer.js";
export type {
  GitCommandFailure,
  GitCommandResult,
  GitCommandSuccess,
  GitHeadResult,
  GitPushBranchInput,
  GitPushRunner
} from "./integrations/git/git-writer.js";
export { compareExecutionScopes } from "./execution/execution-scope.js";
export type {
  ExecutionScope,
  ExecutionScopeMismatch,
  ExecutionScopeMismatchField
} from "./execution/execution-scope.js";
export { runExecutionPreflight } from "./execution/execution-preflight.js";
export type {
  ExecutionPreflightFinding,
  ExecutionPreflightFindingCode,
  ExecutionPreflightInput,
  ExecutionPreflightResult
} from "./execution/execution-preflight.js";
export { executeGitPush } from "./execution/adapters/git-push-adapter.js";
export type {
  ExecuteGitPushInput,
  GitPushExecutionResult,
  GitPushFinding,
  GitPushFindingCode
} from "./execution/adapters/git-push-adapter.js";
export { createFixtureGitHubReadAdapter } from "./integrations/github/github-port.js";
export type { GitHubReadAdapter } from "./integrations/github/github-port.js";
export { createGitHubRestReadAdapter } from "./integrations/github/github-rest-read-adapter.js";
export type {
  GitHubRestFetch,
  GitHubRestFetchResponse,
  GitHubRestReadAdapterOptions
} from "./integrations/github/github-rest-read-adapter.js";
export { createGitHubRestMutationAdapter } from "./integrations/github/github-rest-mutation-adapter.js";
export type {
  GitHubRestMutationAdapter,
  GitHubRestMutationAdapterOptions
} from "./integrations/github/github-rest-mutation-adapter.js";
export type {
  GitHubCreatePullRequestInput,
  GitHubMergePullRequestInput,
  GitHubMutationAction,
  GitHubMutationAdapter,
  GitHubMutationErrorCode,
  GitHubMutationFailure,
  GitHubMutationResult,
  GitHubMutationSuccess
} from "./integrations/github/github-mutation-port.js";
export {
  executeGitHubCreatePullRequest,
  executeGitHubCreatePullRequestAsync,
  executeGitHubMergePullRequest,
  executeGitHubMergePullRequestAsync
} from "./execution/adapters/github-pr-adapter.js";
export type {
  ExecuteGitHubCreatePullRequestAsyncInput,
  ExecuteGitHubCreatePullRequestInput,
  ExecuteGitHubMergePullRequestAsyncInput,
  ExecuteGitHubMergePullRequestInput,
  GitHubPrExecutionFinding,
  GitHubPrExecutionFindingCode,
  GitHubPrExecutionResult
} from "./execution/adapters/github-pr-adapter.js";
export {
  executeBrowserFallbackAction
} from "./execution/adapters/browser-action-adapter.js";
export type {
  BrowserFallbackExecutionResult,
  BrowserFallbackRunnerInput,
  BrowserFallbackRunnerResult,
  ExecuteBrowserFallbackActionInput
} from "./execution/adapters/browser-action-adapter.js";
export {
  classifyBrowserFallbackRisk,
  evaluateBrowserFallbackPolicy
} from "./integrations/browser/browser-fallback-policy.js";
export type {
  BrowserFallbackAction,
  BrowserFallbackApproval,
  BrowserFallbackFinding,
  BrowserFallbackFindingCode,
  BrowserFallbackPolicyInput,
  BrowserFallbackPolicyResult,
  BrowserFallbackTarget
} from "./integrations/browser/browser-fallback-policy.js";
export {
  CODEPM_PLUGIN_CAPABILITIES,
  CODEPM_PLUGIN_SCHEMA_VERSION,
  reviewProposalForClaude,
  reviewPullRequestFromGitHubForClaude,
  reviewPullRequestForClaude
} from "./plugin/index.js";
export type {
  CodePmPluginReviewResult,
  CodePmPluginStatus,
  ReviewProposalForClaudeInput,
  ReviewPullRequestFromGitHubForClaudeInput,
  ReviewPullRequestForClaudeInput
} from "./plugin/index.js";
export type {
  GitHubCheckConclusion,
  GitHubCheckRun,
  GitHubCheckStatus,
  GitHubMergeabilityState,
  GitHubPullRequestLocator,
  GitHubPullRequestMergeability,
  GitHubPullRequestReadResult,
  GitHubPullRequestReview,
  GitHubPullRequestState,
  GitHubReadError,
  GitHubReadErrorCode,
  GitHubReviewState,
  GitHubReviewThread
} from "./integrations/github/github-types.js";
