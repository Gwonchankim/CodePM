# Implementation Plan: CodePM

## Overview

CodePM is a local PM gate and orchestration layer for AI-assisted development. Claude Code does the implementation work through the CLI. Codex acts as the PM: it reviews Claude's plan, asks for changes when the plan is weak, reviews implementation evidence, checks GitHub state, and only then approves or executes the next action through controlled adapters.

This plan is organized as vertical slices. Each slice produces a user-visible workflow that can be run, tested, and reviewed end to end. The first working slice is `review-plan`: read a Claude proposal, validate it, classify risk, produce a PM decision, produce Claude-facing feedback, and write an audit entry. Later slices add diff review, Claude CLI transcript ingestion, GitHub PR review, scoped approval evidence, and controlled action execution.

## MVP Assumptions

- First executable surface: local TypeScript/Node CLI.
- Future surface: Codex plugin wrapper around the same core engine.
- Primary exchange format: Markdown proposals plus structured JSON results.
- Audit format: append-only JSONL.
- GitHub read path: adapter interface first, with `gh` CLI or GitHub connector implementations later.
- Mutation path: disabled by default until a scoped approval and fresh state check exist.
- Browser use: fallback only for GitHub UI actions that cannot be done through structured adapters.

These assumptions can change, but they give the implementation a concrete starting point instead of leaving every task abstract.

## Architecture Decisions

- Keep the core review engine independent from CLI, GitHub, Browser use, and Claude CLI capture.
- Normalize all inputs into shared contracts: `Proposal`, `ActionRequest`, `Evidence`, `Decision`, `RiskResult`, `AuditEntry`.
- Make every `request_changes` decision Claude-facing, with exact changes Claude can apply in the CLI.
- Separate decisions from executions. A PM approval explains what is allowed; an execution adapter performs one approved action after a fresh state check.
- Treat high-risk and irreversible actions as human-gated even when automated checks pass.
- Prefer vertical slices that produce one usable command at a time.

## Dependency Graph

```txt
Project scaffold
  -> Schema and fixtures
    -> Domain contracts
      -> Markdown proposal parser
        -> Risk classifier
          -> Policy decision engine
            -> Decision, feedback, and audit formatters
              -> review-plan CLI
                -> Local git diff adapter
                  -> Diff and secret review
                    -> review-diff CLI
                      -> Claude CLI transcript ingestion
                        -> feedback-for-claude CLI
                          -> GitHub PR read adapter
                            -> review-pr CLI
                              -> Human approval evidence
                                -> Execution preflight
                                  -> GitHub/local git execution adapters
                                    -> Browser fallback guardrails
```

## Vertical Slice Map

| Slice | User-visible workflow | Thin end-to-end path | Primary command |
|---|---|---|---|
| 0 | User can run CodePM locally and see CLI help. | CLI scaffold, domain contracts, fixtures | `codepm --help` |
| 1 | User can ask CodePM to review Claude's plan. | proposal file -> parser -> risk -> decision -> feedback -> audit | `codepm review-plan` |
| 2 | User can ask CodePM to review Claude's implementation diff. | proposal + local git diff -> scope/secret review -> decision -> audit | `codepm review-diff` |
| 3 | User can paste/capture Claude CLI output and get PM feedback. | transcript -> normalized proposal/action -> review -> feedback | `codepm review-claude-output`, `codepm feedback-for-claude` |
| 4 | User can ask CodePM whether a GitHub PR is merge-ready. | proposal/PR input -> GitHub read adapter -> PR gate decision -> audit | `codepm review-pr` |
| 5 | User can execute one approved action through guarded preflight. | decision + approval + fresh state -> adapter execution -> audit | `codepm execute-action` |
| 6 | User can run the workflow safely in real projects. | config + Browser fallback guardrails + E2E scenarios + plugin wrapper | CLI plus plugin wrapper |

## Vertical Slice 0: Runnable CLI Skeleton

**User-visible outcome:** The user can install/run CodePM locally and confirm the CLI shell, project structure, fixtures, and shared contracts exist.

**Thin path:** command invocation -> CLI entrypoint -> help/version output -> smoke test.

### Task 1: Scaffold the CLI project

**Description:** Create the first runnable TypeScript/Node project structure for CodePM while keeping the core engine separate from command-line wiring.

**Acceptance criteria:**
- [x] `package.json` defines scripts for test, build, typecheck, and CLI execution.
- [x] `tsconfig.json` is configured for a Node CLI package.
- [x] `src/` and `tests/` directories match the architecture boundaries in `Spec.md`.
- [x] A placeholder CLI command runs and prints version/help text.

**Verification:**
- [x] `npm test`
- [x] `npm run build`
- [x] Manual run: `node dist/cli/index.js --help`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `tsconfig.json`
- `src/cli/index.ts`
- `src/index.ts`
- `tests/smoke/cli.test.ts`

**Estimated scope:** Medium

### Task 2: Write schema and fixture contracts

**Description:** Convert `Spec.md` proposal, feedback, decision, action request, and audit formats into implementation-ready contracts and fixture files.

**Acceptance criteria:**
- [x] `docs/schema.md` documents required and optional fields.
- [x] Valid and invalid proposal fixtures exist.
- [x] Decision and Claude feedback fixtures exist.
- [x] Action request fixtures cover `plan_review`, `implementation_review`, `push_branch`, `create_pr`, and `merge_pr`.

**Verification:**
- [x] Manual check that fixture section names match `Spec.md`.
- [x] Fixture files can be used directly by parser tests.

**Dependencies:** Task 1

**Files likely touched:**
- `docs/schema.md`
- `tests/fixtures/proposals/`
- `tests/fixtures/decisions/`
- `tests/fixtures/action-requests/`
- `docs/examples/`

**Estimated scope:** Medium

### Task 3: Define domain types

**Description:** Add shared TypeScript types for proposals, actions, risk, decisions, feedback, evidence, GitHub state, approvals, and audit entries.

**Acceptance criteria:**
- [x] Core types are exported from a single domain module.
- [x] Decision values are limited to `approve`, `request_changes`, and `block`.
- [x] Requested actions are limited to known CodePM actions.
- [x] Types include enough fields for Markdown and JSON output.

**Verification:**
- [x] `npm run typecheck`
- [x] Unit test or compile-time check rejects unknown action values.

**Dependencies:** Task 2

**Files likely touched:**
- `src/domain/types.ts`
- `src/domain/actions.ts`
- `src/domain/decision.ts`
- `tests/unit/domain/`

**Estimated scope:** Small

## Checkpoint: Foundation

- [x] CLI project runs locally.
- [x] Schema and fixtures are ready for tests.
- [x] Domain contracts are stable enough to build parser and policy logic.
- [x] Human confirms TypeScript CLI is acceptable as the first executable surface.

## Vertical Slice 1: Review a Claude Plan End-to-End

**User-visible outcome:** The user can pass a Claude Work Proposal to CodePM and receive a PM decision, Claude-facing feedback, JSON output, and an audit entry.

**Thin path:** proposal Markdown -> parser -> risk classifier -> plan reviewer -> formatters -> audit writer -> `review-plan`.

### Task 4: Implement Markdown proposal parser

**Description:** Parse a Claude Work Proposal Markdown document into the shared `Proposal` contract.

**Acceptance criteria:**
- [x] Valid proposal Markdown parses successfully.
- [x] Missing required sections produce actionable validation errors.
- [x] Duplicate required sections produce deterministic validation errors.
- [x] Unknown extra sections are preserved or ignored according to `docs/schema.md`.

**Verification:**
- [x] `npm test -- --run tests/unit/parser`

**Dependencies:** Task 3

**Files likely touched:**
- `src/parser/proposal-parser.ts`
- `src/parser/markdown-sections.ts`
- `tests/unit/parser/`
- `tests/fixtures/proposals/`

**Estimated scope:** Medium

### Task 5: Implement risk classifier

**Description:** Classify a parsed proposal as low, medium, or high risk using policy terms, expected files, risk areas, requested action, and command text.

**Acceptance criteria:**
- [x] Documentation, tests, and local scripts classify as low risk when scoped.
- [x] API, dependency, UI flow, and test infrastructure changes classify as medium risk.
- [x] auth, billing, database, secrets, CI/CD, production config, force push, and destructive git operations classify as high risk.
- [x] Classifier returns reasons and matched policy rules, not only a label.

**Verification:**
- [x] `npm test -- --run tests/unit/policy/risk`

**Dependencies:** Task 4

**Files likely touched:**
- `src/policy/risk-classifier.ts`
- `src/policy/risk-rules.ts`
- `tests/unit/policy/risk-classifier.test.ts`
- `tests/fixtures/proposals/`

**Estimated scope:** Medium

### Task 6: Implement plan review decision engine

**Description:** Produce a PM gate decision for `plan_review` using proposal validation, risk classification, requested action, test plan quality, rollback plan, and open questions.

**Acceptance criteria:**
- [x] Complete low-risk plans can be approved.
- [x] Missing required sections return `request_changes`.
- [x] Understated risk returns `request_changes` with concrete corrections.
- [x] Destructive or high-risk action requests without approval return `block`.

**Verification:**
- [x] `npm test -- --run tests/unit/review/plan`

**Dependencies:** Task 5

**Files likely touched:**
- `src/review/plan-reviewer.ts`
- `src/review/decision-builder.ts`
- `tests/unit/review/plan-reviewer.test.ts`
- `tests/fixtures/decisions/`

**Estimated scope:** Medium

### Task 7: Implement decision, feedback, and audit formatting

**Description:** Format decisions as Markdown, structured JSON, Claude-facing feedback, and append-only audit entries.

**Acceptance criteria:**
- [x] Markdown decision follows the `PM Gate Decision` template.
- [x] Claude feedback lists required changes, evidence needed next, approved actions, and blocked actions.
- [x] JSON result can be consumed by later commands.
- [x] Audit entries redact secret-like values and include required fields.

**Verification:**
- [x] `npm test -- --run tests/unit/formatters tests/unit/audit`

**Dependencies:** Task 6

**Files likely touched:**
- `src/review/decision-formatter.ts`
- `src/review/claude-feedback-formatter.ts`
- `src/audit/audit-writer.ts`
- `tests/unit/formatters/`
- `tests/unit/audit/`

**Estimated scope:** Medium

### Task 8: Implement `review-plan` CLI

**Description:** Expose the first end-to-end workflow: read a proposal file, review it, print decision output, optionally print Claude feedback, and write an audit entry.

**Acceptance criteria:**
- [x] `codepm review-plan <proposal.md>` reads Markdown and exits successfully for valid input.
- [x] Invalid proposals return a non-zero exit code and actionable feedback.
- [x] `--json` outputs structured decision data.
- [x] `--feedback-for-claude` outputs pasteable Claude CLI feedback.
- [x] Audit logging can be enabled with an explicit log path.

**Verification:**
- [x] `npm test -- --run tests/e2e/review-plan`
- [x] Manual run: `codepm review-plan docs/examples/claude-work-proposal.md --feedback-for-claude`

**Dependencies:** Task 7

**Files likely touched:**
- `src/cli/commands/review-plan.ts`
- `src/cli/index.ts`
- `tests/e2e/review-plan.test.ts`
- `docs/examples/claude-feedback.md`

**Estimated scope:** Medium

## Checkpoint: Plan Review MVP

- [x] `review-plan` works from a real Markdown proposal.
- [x] Codex-style PM decisions are stable in Markdown and JSON.
- [x] Claude-facing feedback can be pasted back into Claude Code.
- [x] Audit entries are written without leaking secret-like values.

## Vertical Slice 2: Review Local Implementation Evidence

**User-visible outcome:** The user can ask CodePM whether Claude's actual local changes match the approved plan before push or PR creation.

**Thin path:** proposal Markdown -> local git diff -> diff scope review -> secret scan -> implementation decision -> `review-diff`.

### Task 9: Implement local git diff adapter

**Description:** Read local repository state and changed files without mutating the repo.

**Acceptance criteria:**
- [x] Adapter returns branch name, changed files, and diff text.
- [x] Adapter can compare working tree changes against a configurable base ref.
- [x] Adapter reports when the current directory is not a git repository.
- [x] No command in this adapter mutates local or remote state.

**Verification:**
- [x] `npm test -- --run tests/unit/integrations/git`

**Dependencies:** Task 3

**Files likely touched:**
- `src/integrations/git/git-reader.ts`
- `src/integrations/git/git-types.ts`
- `tests/unit/integrations/git-reader.test.ts`
- `tests/fixtures/diffs/`

**Estimated scope:** Medium

### Task 10: Implement diff scope reviewer

**Description:** Compare actual changed files and diff content against the proposal's expected files and policy boundaries.

**Acceptance criteria:**
- [x] Expected file changes pass scope review.
- [x] Unexpected files are reported with path-level detail.
- [x] Sensitive file paths are flagged.
- [x] Broad changes raise risk or require changes.

**Verification:**
- [x] `npm test -- --run tests/unit/review/diff`

**Dependencies:** Task 9

**Files likely touched:**
- `src/review/diff-reviewer.ts`
- `src/policy/sensitive-paths.ts`
- `tests/unit/review/diff-reviewer.test.ts`
- `tests/fixtures/diffs/`

**Estimated scope:** Medium

### Task 11: Implement secret and credential scan

**Description:** Scan proposals and diffs for obvious credential-like patterns while redacting sensitive values from findings and logs.

**Acceptance criteria:**
- [x] Common token, private key, database URL, and API key patterns are detected.
- [x] `.env` and production config changes are flagged as sensitive.
- [x] Findings include file/path/context without printing the full secret value.
- [x] Secret findings block push and merge action decisions.

**Verification:**
- [x] `npm test -- --run tests/unit/policy/secrets`

**Dependencies:** Task 10

**Files likely touched:**
- `src/policy/secret-scanner.ts`
- `src/policy/redaction.ts`
- `tests/unit/policy/secret-scanner.test.ts`
- `tests/fixtures/diffs/`

**Estimated scope:** Small

### Task 12: Implement `review-diff` CLI

**Description:** Review actual local changes against a proposal and produce a PM decision for implementation evidence.

**Acceptance criteria:**
- [x] `codepm review-diff --proposal <proposal.md>` reviews current local diff.
- [x] Unexpected files return `request_changes` or `block` depending on risk.
- [x] Secret findings block push and merge actions.
- [x] Output includes decision, Claude feedback, JSON, and audit support.

**Verification:**
- [x] `npm test -- --run tests/e2e/review-diff`
- [x] Manual run inside a test git repository with expected and unexpected changes.

**Dependencies:** Task 11

**Files likely touched:**
- `src/cli/commands/review-diff.ts`
- `src/review/implementation-reviewer.ts`
- `tests/e2e/review-diff.test.ts`
- `tests/fixtures/diffs/`

**Estimated scope:** Medium

## Checkpoint: Local Gate

- [x] `review-plan` and `review-diff` both work locally.
- [x] Unexpected files and secrets are caught before push or PR creation.
- [x] Local review flow is still read-only by default.
- [x] Audit log explains plan and implementation decisions.

## Vertical Slice 3: Coordinate With Claude CLI Output

**User-visible outcome:** The user can give CodePM a Claude CLI transcript and get PM feedback without manually extracting every structured block.

**Thin path:** Claude transcript -> normalizer -> existing plan/diff review path -> Claude-facing feedback -> audit.

### Task 13: Implement Claude output normalizer

**Description:** Extract CodePM-relevant proposal, evidence, and action request blocks from copied Claude CLI output or transcript files.

**Acceptance criteria:**
- [x] Structured Markdown blocks are extracted from noisy CLI transcripts.
- [x] Proposal, test evidence, and requested action sections are distinguishable.
- [x] Missing structured blocks produce feedback asking Claude for the required format.
- [x] Normalized output uses the same contracts as file-based proposals.

**Verification:**
- [x] `npm test -- --run tests/unit/orchestration/claude-output`

**Dependencies:** Task 8

**Files likely touched:**
- `src/orchestration/claude-output-normalizer.ts`
- `src/integrations/claude-cli/transcript-reader.ts`
- `tests/unit/orchestration/claude-output-normalizer.test.ts`
- `tests/fixtures/claude-transcripts/`

**Estimated scope:** Medium

### Task 14: Implement Claude feedback command

**Description:** Provide a command that takes a decision JSON or review input and emits concise feedback intended to be pasted back into Claude Code.

**Acceptance criteria:**
- [x] `codepm feedback-for-claude --decision <decision.json>` prints only Claude-facing feedback.
- [x] Feedback contains required changes, evidence needed next, approved actions, and blocked actions.
- [x] Feedback avoids implementation ambiguity and does not expose redacted secret values.
- [x] Command works with decisions produced by `review-plan` and `review-diff`.

**Verification:**
- [x] `npm test -- --run tests/e2e/feedback-for-claude`
- [x] Manual paste test with `docs/examples/claude-feedback.md` shape.

**Dependencies:** Task 13

**Files likely touched:**
- `src/cli/commands/feedback-for-claude.ts`
- `src/review/claude-feedback-formatter.ts`
- `tests/e2e/feedback-for-claude.test.ts`
- `docs/examples/claude-feedback.md`

**Estimated scope:** Small

### Task 15: Implement `review-claude-output` CLI

**Description:** Review a pasted or captured Claude CLI transcript without requiring the user to manually extract the proposal block first.

**Acceptance criteria:**
- [x] `codepm review-claude-output <transcript.txt>` normalizes and reviews the first supported proposal/action block.
- [x] Command can emit PM decision, JSON, and Claude feedback.
- [x] Ambiguous multiple action requests are reported instead of guessed.
- [x] The audit log records the normalized requested action.

**Verification:**
- [x] `npm test -- --run tests/e2e/review-claude-output`

**Dependencies:** Task 14

**Files likely touched:**
- `src/cli/commands/review-claude-output.ts`
- `src/orchestration/claude-review-flow.ts`
- `tests/e2e/review-claude-output.test.ts`
- `tests/fixtures/claude-transcripts/`

**Estimated scope:** Medium

## Checkpoint: Claude PM Loop

- [x] CodePM can ingest Claude CLI output.
- [x] CodePM can send concrete feedback back to Claude.
- [x] Ambiguous Claude action requests are blocked instead of inferred.
- [x] The local Claude-Codex loop works without GitHub.

## Vertical Slice 4: Review GitHub PR Readiness

**User-visible outcome:** The user can ask CodePM whether a PR is safe to create or merge based on current GitHub state.

**Thin path:** repo/PR input -> GitHub read adapter -> checks/reviews/thread evaluation -> PR gate decision -> `review-pr`.

### Task 16: Define GitHub read model and adapter port

**Description:** Define a GitHub state contract that the policy engine can consume without depending on a specific connector implementation.

**Acceptance criteria:**
- [x] `GitHubPullRequestState` includes repo, PR number, base, head SHA, changed files, checks, reviews, unresolved threads, and mergeability.
- [x] Adapter port supports read-only operations needed by `review-pr`.
- [x] Mock adapter can return passing, failing, pending, and unresolved-thread states.

**Verification:**
- [x] `npm test -- --run tests/unit/integrations/github`

**Dependencies:** Task 12

**Files likely touched:**
- `src/integrations/github/github-port.ts`
- `src/integrations/github/github-types.ts`
- `tests/unit/integrations/github-port.test.ts`
- `tests/fixtures/github/`

**Estimated scope:** Small

### Task 17: Implement PR gate reviewer

**Description:** Combine proposal, local policy, diff scope, and GitHub PR state to decide whether PR creation or merge can proceed.

**Acceptance criteria:**
- [x] PR creation requires accurate title/body, risk, tests, and rollback notes.
- [x] Merge is blocked by failing, pending, missing, or stale CI.
- [x] Merge is blocked by unresolved review threads or missing required reviews.
- [x] Merge is blocked when the PR head SHA or diff scope no longer matches approval evidence.

**Verification:**
- [x] `npm test -- --run tests/unit/review/pr-gate`

**Dependencies:** Task 16

**Files likely touched:**
- `src/review/pr-gate-reviewer.ts`
- `src/review/github-state-evaluator.ts`
- `tests/unit/review/pr-gate-reviewer.test.ts`
- `tests/fixtures/github/`

**Estimated scope:** Medium

### Task 18: Implement `review-pr` CLI with mockable GitHub adapter

**Description:** Expose PR gate review as a command while keeping real GitHub access behind an adapter.

**Acceptance criteria:**
- [x] `codepm review-pr --repo owner/name --pr 123` can run with a configured adapter.
- [x] Test mode can read recorded or fixture GitHub state.
- [x] Command outputs Markdown decision, JSON, Claude feedback, and audit entry.
- [x] Command never mutates GitHub state.

**Verification:**
- [x] `npm test -- --run tests/e2e/review-pr`
- [x] Manual dry run against a fixture PR state file.

**Dependencies:** Task 17

**Files likely touched:**
- `src/cli/commands/review-pr.ts`
- `src/integrations/github/fixture-github-adapter.ts`
- `tests/e2e/review-pr.test.ts`
- `tests/fixtures/github/`

**Estimated scope:** Medium

## Checkpoint: GitHub Gate

- [x] CodePM can review PR readiness without mutating GitHub.
- [x] CI failures and unresolved review threads block merge decisions.
- [x] PR decisions include exact next action for Claude or the user.
- [x] GitHub state timestamps are included in audit output.

## Vertical Slice 5: Execute One Approved Action Safely

**User-visible outcome:** The user can let CodePM perform one explicitly approved GitHub/local git action after fresh preflight checks.

**Thin path:** decision JSON -> approval evidence -> fresh state check -> exact adapter -> execution audit -> `execute-action`.

### Task 19: Implement human approval evidence

**Description:** Represent explicit human approval for medium-risk and high-risk mutations without making approval broad or reusable by accident.

**Acceptance criteria:**
- [x] Approval evidence records approver, timestamp, repo, branch, PR, action, risk, and scope.
- [x] Approval can be validated against a decision and current state.
- [x] Approval for one action cannot authorize another action.
- [x] Expired or mismatched approval evidence blocks execution.

**Verification:**
- [x] `npm test -- --run tests/unit/policy/approval`

**Dependencies:** Task 18

**Files likely touched:**
- `src/policy/approval-evidence.ts`
- `src/policy/approval-validator.ts`
- `tests/unit/policy/approval-validator.test.ts`
- `tests/fixtures/approvals/`

**Estimated scope:** Medium

### Task 20: Implement execution preflight

**Description:** Add the guard that turns a prior PM decision plus fresh repository/GitHub state into either executable permission or a block.

**Acceptance criteria:**
- [x] Execution requires an `approve` decision for the exact requested action.
- [x] Execution re-checks fresh local/GitHub state.
- [x] Changed repo, branch, PR number, head SHA, or diff state blocks execution.
- [x] Preflight writes an audit entry before and after attempted execution.

**Verification:**
- [x] `npm test -- --run tests/unit/execution/preflight`

**Dependencies:** Task 19

**Files likely touched:**
- `src/execution/execution-preflight.ts`
- `src/execution/execution-scope.ts`
- `tests/unit/execution/preflight.test.ts`
- `tests/fixtures/decisions/`

**Estimated scope:** Medium

### Task 21: Implement local git push execution adapter

**Description:** Add a controlled adapter for approved branch pushes. The adapter is off by default and only runs after preflight succeeds.

**Acceptance criteria:**
- [x] Push execution requires explicit branch and remote target.
- [x] Adapter refuses force push unless explicitly approved for that exact action.
- [x] Adapter checks that no new secret findings appeared since approval.
- [x] Adapter records command, result, and final state in audit log.

**Verification:**
- [x] `npm test -- --run tests/unit/execution/git-push`
- [x] Integration test against a local bare test repository.

**Dependencies:** Task 20

**Files likely touched:**
- `src/execution/adapters/git-push-adapter.ts`
- `src/integrations/git/git-writer.ts`
- `tests/unit/execution/git-push-adapter.test.ts`
- `tests/integration/git-push.test.ts`

**Estimated scope:** Medium

### Task 22: Implement GitHub PR creation and merge execution adapters

**Description:** Add controlled adapters for approved PR creation and merge using structured GitHub interfaces before Browser use is considered.

**Acceptance criteria:**
- [x] PR creation requires approved title, body, branch, risk, tests, and rollback notes.
- [x] Merge requires fresh green CI, resolved threads, required reviews, expected head SHA, and scoped approval.
- [x] Adapter records GitHub URL, mutation result, and state timestamp in audit log.
- [x] Adapter blocks when GitHub state differs from the reviewed state.

**Verification:**
- [x] `npm test -- --run tests/unit/execution/github-actions`
- [x] Integration test with mocked GitHub mutation adapter.

**Dependencies:** Task 20

**Files likely touched:**
- `src/execution/adapters/github-pr-adapter.ts`
- `src/integrations/github/github-mutation-port.ts`
- `tests/unit/execution/github-pr-adapter.test.ts`
- `tests/integration/github-actions.test.ts`

**Estimated scope:** Medium

### Task 23: Implement `execute-action` CLI

**Description:** Expose action execution through a command that consumes prior decision JSON and approval evidence, then runs only one scoped action after preflight.

**Acceptance criteria:**
- [x] `codepm execute-action --decision <decision.json>` refuses missing or non-approved decisions.
- [x] `--approval <approval.json>` is required for medium-risk and high-risk mutations.
- [x] Command prints the preflight result before mutation.
- [x] Command writes audit entries for allowed, blocked, failed, and successful executions.

**Verification:**
- [x] `npm test -- --run tests/e2e/execute-action`

**Dependencies:** Tasks 21 and 22

**Files likely touched:**
- `src/cli/commands/execute-action.ts`
- `src/execution/action-runner.ts`
- `tests/e2e/execute-action.test.ts`
- `tests/fixtures/approvals/`

**Estimated scope:** Medium

## Checkpoint: Controlled Execution

- [x] Execution is impossible without a fresh scoped approval path.
- [x] Push, PR creation, and merge adapters are guarded by preflight.
- [x] Audit log captures attempted and completed mutations.
- [x] Review commands remain read-only by default.

## Vertical Slice 6: Harden the PM Workflow for Real Projects

**User-visible outcome:** The user can adapt CodePM to a real project policy, run full workflow scenarios, and eventually call the same engine through a Codex plugin wrapper.

**Thin path:** project config -> guarded fallback policies -> realistic workflow tests -> docs -> plugin wrapper.

### Task 24: Implement Browser fallback guardrails

**Description:** Document and enforce the conditions under which Browser use may be used for GitHub UI actions that structured adapters cannot perform.

**Acceptance criteria:**
- [x] Browser fallback requires explicit user approval for the exact action.
- [x] Browser fallback cannot run from review-only commands.
- [x] Browser fallback records intended action before execution and observed result after execution.
- [x] Merge, branch deletion, force push, review dismissal, and production deploy remain high-risk.

**Verification:**
- [x] `npm test -- --run tests/unit/execution/browser-fallback`
- [x] Manual review confirms Browser use cannot be triggered silently.

**Closure note:** Manual review on 2026-05-25 confirmed that review-only commands are blocked before any Browser runner call, structured adapters take precedence, explicit action/target approval is required, and fallback execution writes intended and observed audit records.

**Dependencies:** Task 23

**Files likely touched:**
- `src/integrations/browser/browser-fallback-policy.ts`
- `src/execution/adapters/browser-action-adapter.ts`
- `tests/unit/execution/browser-fallback-policy.test.ts`
- `docs/policies/pm-gate-policy.md`

**Estimated scope:** Medium

### Task 25: Add project configuration support

**Description:** Allow projects to customize policy thresholds, sensitive paths, audit log location, GitHub adapter mode, and default base branch.

**Increment status:**
- [x] 25A: Add `codepm.config.json` schema, loader, secure defaults, and unsafe override validation.
- [x] 25B: Wire review config into `review-diff` base ref, max changed files, and sensitive path handling.
- [x] 25C: Wire audit and GitHub adapter mode defaults into CLI execution paths.
- [x] 25D: Finalize configuration documentation and examples.

**Acceptance criteria:**
- [x] `codepm.config.json` can override safe policy settings.
- [x] Config cannot disable secret scanning or high-risk human approval.
- [x] Missing config uses secure defaults.
- [x] Config validation returns actionable errors.
- [x] Configuration docs and examples cover command precedence and fixture-only GitHub mode.

**Verification:**
- [x] `npm test -- --run tests/unit/config`
- [x] `npm test -- --run tests/unit/policy tests/unit/review/diff-reviewer tests/e2e/review-diff`
- [x] `npm test -- --run tests/e2e/execute-action`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Dependencies:** Task 12

**Files likely touched:**
- `src/config/config-loader.ts`
- `src/config/config-schema.ts`
- `src/cli/commands/execute-action.ts`
- `tests/e2e/execute-action.test.ts`
- `tests/unit/config/config-loader.test.ts`
- `docs/configuration.md`
- `docs/examples/codepm.config.json`
- `docs/examples/configuration-usage.md`

**Estimated scope:** Medium

### Task 26: Add end-to-end workflow scenarios

**Description:** Add realistic tests and documentation for the complete Claude-Codex PM loop.

**Acceptance criteria:**
- [x] Scenario 1 covers low-risk plan approval.
- [x] Scenario 2 covers implementation diff with unexpected file.
- [x] Scenario 3 covers PR merge blocked by failing CI.
- [x] Scenario 4 covers approved low-risk PR action through a mocked execution adapter.
- [x] Documentation explains the recommended human workflow.

**Verification:**
- [x] `npm test -- --run tests/e2e/workflows`
- [x] `npm test -- --run tests/e2e`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Dependencies:** Tasks 23, 24, and 25

**Files likely touched:**
- `tests/e2e/workflows/`
- `docs/workflows/claude-codex-loop.md`
- `README.md`
- `docs/examples/`

**Estimated scope:** Medium

### Task 27: Prepare Codex plugin wrapper

**Description:** Add a thin plugin-oriented integration layer after the CLI and core review engine are stable.

**Acceptance criteria:**
- [x] Plugin wrapper calls the same core review engine as CLI commands.
- [x] Plugin can review a proposal and produce Claude feedback.
- [x] Plugin can call GitHub read adapter when available.
- [x] Plugin does not bypass approval or execution preflight rules.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Dependencies:** Task 26

**Files likely touched:**
- `plugins/codepm/`
- `src/plugin/`
- `tests/smoke/plugin.test.ts`
- `docs/plugin.md`

**Estimated scope:** Medium

### Task 28: Close MVP implementation plan

**Description:** Reconcile stale planning checkboxes with implemented behavior, complete the Browser fallback manual review, record plugin validation status, and run final regression checks without changing runtime behavior.

**Acceptance criteria:**
- [x] Task 1-27 acceptance and verification checkboxes reflect the implemented MVP state.
- [x] Browser fallback manual review is recorded with explicit non-silent execution evidence.
- [x] Plugin manifest coverage is recorded through smoke tests, with external validator limitations documented.
- [x] Remaining work is separated into post-MVP backlog rather than open MVP tasks.

**Verification:**
- [x] `npm test -- --run tests/unit/execution/browser-fallback-policy.test.ts`
- [x] `npm test -- --run tests/smoke/plugin.test.ts`
- [x] `node dist/cli/index.js --help`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** `tests/smoke/plugin.test.ts` verifies plugin wrapper behavior and required manifest metadata. The external Codex plugin validator was initially blocked by a missing `yaml` module in the bundled Python environment; Task 29 closes that validation gap with a temporary PyYAML target and no runtime dependency changes.

**Dependencies:** Task 27

**Files likely touched:**
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 29: Validate plugin scaffold and packaging readiness

**Description:** Run the repo-local Codex plugin scaffold through the plugin-creator validator using a temporary PyYAML target, document the validation command, and record the result without changing runtime behavior.

**Acceptance criteria:**
- [x] `plugins/codepm` passes `validate_plugin.py`.
- [x] Validator setup uses temporary PyYAML only and does not add repo runtime dependencies.
- [x] `docs/plugin.md` documents the validator workflow.
- [x] Marketplace, app connector, broader MCP surfaces, and real GitHub mutation work remain post-MVP.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task29-pyyaml`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Validation passed on 2026-05-25. `PyYAML` was installed only into `.tmp-codepm-tests\task29-pyyaml` for the validator process; `package.json`, `package-lock.json`, `src/`, CLI behavior, and plugin wrapper APIs were unchanged.

**Dependencies:** Task 28

**Files likely touched:**
- `docs/plugin.md`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 30A: Add review-only Codex MCP connector

**Description:** Add a minimal stdio MCP server that exposes the existing CodePM review engine through read-only tools for Codex integrations.

**Acceptance criteria:**
- [x] `codepm-mcp` bin starts `dist/mcp/index.js` and `--help` documents the read-only surface.
- [x] MCP server uses `McpServer`, `StdioServerTransport`, and `zod/v4` schemas from the official v1 SDK path.
- [x] MCP tool registry exposes exactly `codepm_review_proposal`, `codepm_review_pr_fixture`, and `codepm_capabilities`.
- [x] Proposal review returns `CodePmPluginReviewResult` as structured content and Claude-facing feedback as text.
- [x] PR fixture review uses fixture-provided `GitHubPullRequestState` through a read adapter.
- [x] Capabilities explicitly report `supportsExecutionMutation: false`.
- [x] Plugin scaffold declares `plugins/codepm/.mcp.json` through `mcpServers`.
- [x] MCP docs and plugin docs explain the review-only boundary.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/mcp/index.js --help`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task29-pyyaml`
- [x] `npm test`

**Closure note:** Validation passed on 2026-05-25 after installing `PyYAML` only into a temporary target for the validator process. The temporary target was removed after validation. The MCP connector remains review-only and does not expose `execute-action`, git push, GitHub mutation adapters, Browser fallback, or local diff review.

**Dependencies:** Task 29

**Files likely touched:**
- `src/mcp/`
- `plugins/codepm/`
- `tests/smoke/mcp-server.test.ts`
- `docs/mcp.md`
- `docs/plugin.md`
- `package.json`
- `package-lock.json`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 30B: Add MCP review-diff with cwd sandbox policy

**Description:** Extend the review-only MCP connector with local diff review guarded by `CODEPM_MCP_ALLOWED_ROOTS`.

**Acceptance criteria:**
- [x] MCP tool registry includes `codepm_review_diff` and still excludes execution, push, PR mutation, merge, and Browser fallback tools.
- [x] `codepm_review_diff` requires `cwd` and blocks paths outside `CODEPM_MCP_ALLOWED_ROOTS` before config, proposal, or git review.
- [x] Relative `configPath` resolves from `cwd`, and config paths outside allowed roots are blocked before reading.
- [x] Config `defaults.baseRef`, `review.maxChangedFiles`, and `review.additionalSensitivePaths` apply to MCP diff review.
- [x] Proposal parse failure, invalid config, and git read failure return plugin-style structured results without mutation.
- [x] Capabilities report `supportsLocalDiffReview: true` and `supportsExecutionMutation: false`.
- [x] MCP docs and plugin skill guidance explain allowed roots and read-only execution boundaries.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts tests/e2e/review-diff.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/mcp/index.js --help`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task29-pyyaml`
- [x] `npm test`

**Closure note:** MCP local diff review now performs read-only git inspection only after cwd/config paths pass the allowed-roots policy. It does not write audit logs and does not expose execution mutation, git push, GitHub mutation, merge, or Browser fallback.

**Dependencies:** Task 30A

**Files likely touched:**
- `src/mcp/`
- `tests/smoke/mcp-server.test.ts`
- `docs/mcp.md`
- `docs/plugin.md`
- `plugins/codepm/skills/codepm/SKILL.md`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 30C: Polish MCP/plugin local packaging docs

**Description:** Document and test the repo-local Codex plugin and MCP setup path so a local user can build, load, allow roots, and validate the review-only connector without changing runtime behavior.

**Acceptance criteria:**
- [x] README includes a Codex Plugin / MCP quick start with build, help, plugin path, allowed roots, and execution boundary guidance.
- [x] MCP docs include Windows and POSIX `CODEPM_MCP_ALLOWED_ROOTS` examples.
- [x] MCP docs explain that `.mcp.json` points to `node ../../dist/mcp/index.js` from `plugins/codepm`.
- [x] Plugin docs include a local validation checklist covering smoke tests, typecheck, build, help, and validator.
- [x] Copyable local setup example exists for MCP build, allowed roots, plugin path, and validation.
- [x] Smoke tests assert docs keep MCP setup, `codepm_review_diff`, `CODEPM_MCP_ALLOWED_ROOTS`, and mutation boundaries visible.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/mcp/index.js --help`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task29-pyyaml`
- [x] `npm test`

**Closure note:** Task 30C changed only documentation, examples, tests, and plan bookkeeping. MCP tool contracts, CLI behavior, plugin manifest shape, and runtime code paths remain unchanged.

**Dependencies:** Task 30B

**Files likely touched:**
- `README.md`
- `docs/mcp.md`
- `docs/plugin.md`
- `docs/examples/mcp-local-setup.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 31A: Add read-only GitHub REST adapter

**Description:** Add a read-only GitHub REST/GraphQL adapter that normalizes live PR state into the existing `GitHubPullRequestState` model, tested only with mocked HTTP.

**Acceptance criteria:**
- [x] `createGitHubRestReadAdapter` implements `GitHubReadAdapter` without adding CLI, MCP, Browser, push, PR creation, or merge wiring.
- [x] Adapter reads PR metadata, files, reviews, check runs, legacy statuses, and review threads into `GitHubPullRequestState`.
- [x] REST pagination and GraphQL review-thread cursor pagination are handled.
- [x] `401`/`403`, `404`, malformed locators, invalid JSON, unexpected shapes, and GraphQL errors map to typed read errors.
- [x] Authorization and GitHub API version headers are sent when appropriate, without leaking tokens in errors.
- [x] Public exports expose the adapter factory and option/fetch types.
- [x] Documentation explains token usage, read-only boundary, mocked testing, and 31B wiring deferral.

**Verification:**
- [x] `npm test -- --run tests/unit/integrations/github`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 31A adds the live-read adapter implementation behind the existing read port only. CLI/config/MCP/plugin live GitHub wiring was intentionally deferred, and no mutation capability was introduced.

**Dependencies:** Task 30C

**Files likely touched:**
- `src/integrations/github/`
- `src/index.ts`
- `tests/unit/integrations/github/`
- `docs/github-read-adapter.md`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 31B: Wire `review-pr` GitHub adapter opt-in

**Description:** Connect the 31A read-only GitHub adapter to `codepm review-pr` behind an explicit `--adapter github` flag while preserving fixture mode as the default.

**Acceptance criteria:**
- [x] `review-pr` accepts `--adapter <fixture|github>` and defaults to fixture mode.
- [x] Fixture mode keeps requiring `--state <github-state.json>` and rejects GitHub-only flags.
- [x] GitHub mode rejects `--state`, requires a non-empty token env, and reads PR state through `createGitHubRestReadAdapter`.
- [x] GitHub adapter read failures become safe block decisions without leaking token values.
- [x] Existing PR gate Markdown, JSON, Claude feedback, and audit formatting are reused after successful state reads.
- [x] CLI/config/MCP/plugin mutation surfaces remain unchanged; no push, create PR, merge, or Browser fallback path is added.
- [x] Docs describe fixture default mode, GitHub opt-in flags, and the read-only boundary.

**Verification:**
- [x] `npm test -- --run tests/e2e/review-pr.test.ts`
- [x] `npm test -- --run tests/unit/integrations/github`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 31B wires live GitHub PR reads only into the `review-pr` CLI as explicit opt-in. Project config remains fixture-only, MCP/plugin real GitHub review remains deferred, and GitHub mutation remains unavailable.

**Dependencies:** Task 31A

**Files likely touched:**
- `src/cli/commands/review-pr.ts`
- `src/cli/index.ts`
- `tests/e2e/review-pr.test.ts`
- `docs/github-read-adapter.md`
- `docs/workflows/claude-codex-loop.md`
- `README.md`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 31C: Wire `review-pr` GitHub adapter config

**Description:** Connect read-only PR review adapter defaults from `codepm.config.json` to `codepm review-pr` while keeping execution mutation adapter config fixture-only.

**Acceptance criteria:**
- [x] Config schema supports `github.prReadAdapterMode`, `github.prReadTokenEnv`, `github.prReadApiBaseUrl`, and `github.prReadApiVersion`.
- [x] `github.adapterMode` remains fixture-only for `execute-action` mutation adapters.
- [x] `review-pr --config <path>` loads config before proposal, fixture, or GitHub state reads.
- [x] `--adapter` and GitHub CLI flags override PR read config defaults.
- [x] Fixture mode still requires `--state`, GitHub mode still rejects `--state`, and token env remains required for GitHub mode.
- [x] `review-pr` audit behavior remains opt-in through `--audit-log`; config `defaults.auditLogPath` is not used.
- [x] Docs and example config describe the read-only PR adapter settings and mutation boundary.

**Verification:**
- [x] `npm test -- --run tests/unit/config tests/e2e/review-pr.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 31C makes live GitHub PR reads configurable only for `review-pr`. It does not add MCP/plugin real GitHub wiring, live GitHub smoke tests, or any real GitHub mutation adapter.

**Dependencies:** Task 31B

**Files likely touched:**
- `src/config/`
- `src/cli/commands/review-pr.ts`
- `tests/unit/config/`
- `tests/e2e/review-pr.test.ts`
- `docs/configuration.md`
- `docs/github-read-adapter.md`
- `docs/examples/codepm.config.json`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 31D: Wire MCP/plugin real GitHub PR review opt-in

**Description:** Expose the read-only GitHub PR adapter through the plugin wrapper and MCP as explicit opt-in review surfaces without adding any mutation capability.

**Acceptance criteria:**
- [x] Plugin exports `reviewPullRequestFromGitHubForClaude` and accepts token env, API base URL, API version, and injected fetch options.
- [x] Plugin helper reads tokens only from environment variables and returns `adapter_error` before fetch when the env var is missing.
- [x] MCP exposes `codepm_review_pr_github` alongside the existing review-only tools.
- [x] MCP real GitHub PR review accepts env var name and API overrides but not raw token input.
- [x] Capabilities advertise real GitHub PR read support while keeping `supportsExecutionMutation: false`.
- [x] Docs and CodePM skill explain token env usage, external read-only GitHub access, and the unchanged mutation boundary.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts`
- [x] `npm test -- --run tests/unit/integrations/github`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/mcp/index.js --help`
- [x] `npm test`

**Closure note:** Task 31D adds real GitHub PR reads to plugin/MCP review flows only. It does not add live smoke tests, config loading inside MCP, GitHub mutation, app connector behavior, marketplace packaging, or Browser fallback.

**Dependencies:** Task 31C

**Files likely touched:**
- `src/plugin/`
- `src/mcp/`
- `src/index.ts`
- `tests/smoke/`
- `docs/mcp.md`
- `docs/plugin.md`
- `docs/github-read-adapter.md`
- `plugins/codepm/skills/codepm/SKILL.md`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 31E: Document real GitHub read review usage and live-smoke guide

**Description:** Finish the read-only real GitHub PR review slice from the user perspective by documenting CLI, config, MCP, plugin, GitHub Enterprise, and optional manual live-smoke usage without adding runtime behavior.

**Acceptance criteria:**
- [x] README explains `review-pr --adapter github`, config default PR read, `codepm_review_pr_github`, and the execution boundary.
- [x] Workflow docs describe PR gate choices: fixture, CLI live read, and MCP live read.
- [x] MCP and plugin docs emphasize token env usage, no raw token inputs, external read-only GitHub access, and no mutation.
- [x] `docs/examples/github-read-review.md` provides copyable CLI, config, MCP, plugin, GitHub Enterprise, and optional manual live-smoke examples.
- [x] Smoke tests assert the real GitHub read docs and examples stay visible and do not show raw token input fields.
- [x] Post-MVP backlog reflects that real GitHub read is complete while real GitHub mutation, app connector, marketplace/release packaging, and optional credentialed live smoke remain future work.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts`
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/mcp/index.js --help`
- [x] `npm test`

**Closure note:** Task 31E changes documentation, examples, smoke coverage, and plan bookkeeping only. It does not add a live network test to the default suite and does not change CLI, config, MCP, plugin, or execution behavior.

**Dependencies:** Task 31D

**Files likely touched:**
- `README.md`
- `docs/workflows/claude-codex-loop.md`
- `docs/mcp.md`
- `docs/plugin.md`
- `docs/examples/github-read-review.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 32A: Release and package readiness

**Description:** Make CodePM inspectable as a local npm package/tarball without publishing it. Keep `private: true`, define the runtime package entrypoints and allowlist, stabilize dry-run packaging with a workspace-local npm cache, and add smoke coverage for the package contents.

**Acceptance criteria:**
- [x] `package.json` keeps `private: true` and declares `license`, `main`, `types`, `exports`, CLI/MCP bins, and a package `files` allowlist.
- [x] Package contents are limited to built `dist/` output, README, docs, and `plugins/codepm/**`.
- [x] `pack:dry-run` uses `.tmp-codepm-tests/npm-cache` to avoid OS npm cache permission issues.
- [x] `release:check` runs typecheck, build, tests, and package dry-run in order.
- [x] `.tmp-codepm-tests/` is ignored and no `.npmignore` is introduced, leaving `package.json.files` as the package allowlist source of truth.
- [x] Smoke coverage parses `npm run pack:dry-run` JSON and checks included runtime/docs/plugin files plus excluded source/tests/temp/env files.
- [x] README and plugin validation docs include the package readiness commands.

**Verification:**
- [x] `npm test -- --run tests/smoke/package-readiness.test.ts tests/smoke/plugin.test.ts`
- [x] `npm run pack:dry-run`
- [x] `npm run release:check`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/cli/index.js --help`
- [x] `node dist/mcp/index.js --help`
- [x] `npm test`

**Closure note:** Task 32A prepares local package inspection only. It does not run `npm publish`, change the package version, configure a registry, create a release tag, generate a changelog, add marketplace packaging, or add real GitHub mutation adapters.

**Dependencies:** Task 31E

**Files likely touched:**
- `package.json`
- `package-lock.json`
- `.gitignore`
- `README.md`
- `docs/plugin.md`
- `tests/smoke/package-readiness.test.ts`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 32B: Local tarball install smoke and release runbook

**Description:** Prove the package works when consumed from a real local tarball without publishing it, and document the release preflight boundary for future release work.

**Acceptance criteria:**
- [x] `pack:smoke` creates a tarball under `.tmp-codepm-tests/package-smoke/`, extracts it, installs it into a temp consumer layout, and verifies packaged CLI/MCP help entrypoints.
- [x] `pack:smoke` imports `CODEPM_PLUGIN_CAPABILITIES` through the package `exports` field from the temp consumer.
- [x] `pack:smoke` checks the installed package does not include source, tests, temp directories, or env files.
- [x] `release:check` runs typecheck, build, tests, package dry-run, and package smoke in order.
- [x] `docs/release.md` documents local release preflight, plugin validator, `private: true`, and the no-publish boundary.
- [x] README and plugin validation docs link the package smoke and release runbook into the existing release checklist.

**Verification:**
- [x] `npm test -- --run tests/smoke/package-readiness.test.ts`
- [x] `npm test -- --run tests/smoke/package-readiness.test.ts tests/smoke/plugin.test.ts`
- [x] `npm run pack:dry-run`
- [x] `npm run pack:smoke`
- [x] `npm run release:check`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/cli/index.js --help`
- [x] `node dist/mcp/index.js --help`
- [x] `npm test`

**Closure note:** Task 32B does not publish, bump versions, create release tags, configure registries, generate changelogs, or add marketplace/app/GitHub mutation behavior.

**Dependencies:** Task 32A

**Files likely touched:**
- `package.json`
- `scripts/package-smoke.mjs`
- `README.md`
- `docs/release.md`
- `docs/plugin.md`
- `tests/smoke/package-readiness.test.ts`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 33A: Marketplace packaging prep

**Description:** Prepare CodePM for future Codex marketplace registration by documenting the marketplace entry shape, adding a copyable example, and testing the registration boundary without creating a real marketplace entry.

**Acceptance criteria:**
- [x] `docs/marketplace.md` documents the repo-local plugin path, marketplace source path, default marketplace policy, and pre-registration checklist.
- [x] `docs/examples/codepm-marketplace.json` provides a valid copyable marketplace entry preview with `./plugins/codepm`, `AVAILABLE`, `ON_INSTALL`, and `Productivity`.
- [x] Smoke coverage parses the marketplace example and verifies no `policy.products` override is present.
- [x] Docs explicitly state that this task does not create or update `.agents/plugins/marketplace.json`, personal marketplace state, app connector files, or npm publish state.
- [x] README and plugin docs link the marketplace prep docs and example.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/package-readiness.test.ts`
- [x] `npm run pack:dry-run`
- [x] `npm run pack:smoke`
- [x] `node dist/mcp/index.js --help`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task33a-pyyaml`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 33A adds marketplace prep docs, a marketplace JSON example, smoke coverage, and plan bookkeeping only. It does not register CodePM in a marketplace, create `.agents/plugins/marketplace.json`, add assets, add an app connector, publish, bump versions, tag releases, generate changelogs, or add mutation behavior.

**Dependencies:** Task 32B

**Files likely touched:**
- `README.md`
- `docs/plugin.md`
- `docs/marketplace.md`
- `docs/examples/codepm-marketplace.json`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 34A: App connector integration prep

**Description:** Document the future app connector boundary and prerequisites without creating a real app connector, adding `.app.json`, changing plugin manifest `apps`, or exposing new runtime behavior.

**Acceptance criteria:**
- [x] `docs/app-connector.md` explains that the current supported integration surface is the repo-local plugin plus MCP review-only connector.
- [x] App connector prerequisites are documented: connector id, owning account/team, auth policy, app registration target, privacy/TOS/homepage/repository URLs, and approval path.
- [x] Docs state that app connector creation must start review-only and must not expose push, PR creation, merge, Browser fallback, or `execute-action` bypass.
- [x] README, plugin docs, and marketplace docs link the app connector prep boundary.
- [x] Smoke coverage confirms `plugins/codepm/.app.json` does not exist and `plugin.json` still has no `apps` field.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/package-readiness.test.ts`
- [x] `npm run pack:dry-run`
- [x] `npm run pack:smoke`
- [x] `node dist/mcp/index.js --help`
- [x] `validate_plugin.py plugins\codepm` with `PYTHONPATH=.tmp-codepm-tests\task33a-pyyaml`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 34A adds app connector prep docs, smoke coverage, and plan bookkeeping only. It does not create `.app.json`, add `apps` to the plugin manifest, register an app connector, register marketplace state, add assets, add runtime code, add MCP tools, add CLI commands, publish, or add mutation behavior.

**Dependencies:** Task 33A

**Files likely touched:**
- `README.md`
- `docs/plugin.md`
- `docs/marketplace.md`
- `docs/app-connector.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 35A: Real GitHub mutation adapter design prep

**Description:** Document the safety requirements and future implementation boundary for real GitHub PR creation and merge mutation adapters without adding runtime mutation support.

**Acceptance criteria:**
- [x] `docs/github-mutation-adapter.md` documents the current fixture-only mutation boundary and future real mutation requirements.
- [x] Existing user docs link read-only GitHub support to the separate real-mutation design prep boundary.
- [x] Smoke coverage confirms `github.adapterMode` remains fixture-only, `--github-result <fixture.json>` remains required for fixture mode, and real GitHub mutation requires a later explicit execution task.
- [x] Future design requirements cover token env authentication, least-privilege scopes, repo allowlist, exact action/target matching, expected head SHA, PR gate re-read, approval/preflight evidence, audit redaction, and typed redacted errors.
- [x] Docs state that MCP, plugin, app connector, and Browser fallback surfaces must not bypass `execute-action`.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/package-readiness.test.ts`
- [x] `npm test -- --run tests/unit/config tests/e2e/execute-action.test.ts tests/unit/execution/github-pr-adapter.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 35A adds design documentation, doc links, smoke coverage, and plan bookkeeping only. It does not add `github.adapterMode: "github"`, token flags to `execute-action`, live GitHub mutation smoke, a real GitHub mutation adapter, MCP/plugin/app mutation helpers, Browser fallback bypass, or release behavior.

**Dependencies:** Task 34A

**Files likely touched:**
- `README.md`
- `docs/configuration.md`
- `docs/github-read-adapter.md`
- `docs/github-mutation-adapter.md`
- `docs/workflows/claude-codex-loop.md`
- `docs/plugin.md`
- `docs/mcp.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 35B: Mocked HTTP GitHub REST mutation adapter

**Description:** Add a low-level async GitHub REST mutation adapter for PR creation and merge, verified entirely with mocked HTTP, without wiring it into CLI/config/MCP/plugin/app execution surfaces.

**Acceptance criteria:**
- [x] `createGitHubRestMutationAdapter` exists as a separate async adapter and is exported from the public package surface.
- [x] The existing synchronous `GitHubMutationAdapter` execution port and `execute-action` fixture-only behavior remain unchanged.
- [x] The adapter requires a non-empty token, exact `allowedRepos` allowlist, and mocked/injected fetch support for deterministic tests.
- [x] `create_pr` sends GitHub REST create PR requests, validates same-repo expected head SHA before POST, and safely rejects fork-style expected-SHA creation in this slice.
- [x] `merge_pr` sends GitHub REST merge requests with expected head SHA and optional merge method.
- [x] HTTP, fetch, invalid JSON, and unexpected response failures map to existing `GitHubMutationResult` error codes without leaking tokens or raw response bodies.
- [x] Docs and smoke coverage state that the low-level adapter exists while config/MCP/plugin/app mutation surfaces remain closed.

**Verification:**
- [x] `npm test -- --run tests/unit/integrations/github tests/smoke/plugin.test.ts`
- [x] `npm test -- --run tests/e2e/execute-action.test.ts tests/unit/execution/github-pr-adapter.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm test`

**Closure note:** Task 35B adds mocked HTTP adapter implementation, unit tests, exports, docs, smoke coverage, and plan bookkeeping only. It does not add `github.adapterMode: "github"`, token flags to `execute-action`, live GitHub mutation smoke, config support, MCP/plugin/app mutation helpers, Browser fallback bypass, or release behavior.

**Dependencies:** Task 35A

**Files likely touched:**
- `src/integrations/github/github-rest-mutation-adapter.ts`
- `src/index.ts`
- `tests/unit/integrations/github/github-rest-mutation-adapter.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/github-read-adapter.md`
- `docs/github-mutation-adapter.md`
- `docs/workflows/claude-codex-loop.md`
- `docs/plugin.md`
- `docs/mcp.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 35C: `execute-action` real GitHub mutation opt-in

**Description:** Wire the low-level async GitHub REST mutation adapter into `codepm execute-action` behind explicit CLI opt-in while keeping fixture mode as the default and keeping config/MCP/plugin/app surfaces non-mutating.

**Acceptance criteria:**
- [x] `execute-action` accepts `--github-mutation-adapter <fixture|github>` plus token env, repo allowlist, and optional GitHub API base/version flags.
- [x] Fixture mode remains the default, still requires `--github-result <fixture.json>`, and rejects GitHub-only flags before adapter/fetch work.
- [x] `create_pr --github-mutation-adapter github` requires `--expected-head-sha`, forbids `--github-result`, checks token env and exact allowed repo before fetch, and calls the REST mutation adapter only after preflight allows.
- [x] `merge_pr --github-mutation-adapter github` requires `--approval`, `--repo`, `--pr`, `--expected-head-sha`, and at least one `--required-check`; it forbids `--state`/`--github-result`, reads PR state for preflight scope, re-reads fresh PR state, and blocks stale or failing gates before REST merge.
- [x] `runCliAsync` routes `execute-action` through the async path while the sync fixture path remains backward compatible.
- [x] Output keeps `codepm.execution.v1` Markdown/JSON shape, audit ordering, mutation metadata, and token redaction.
- [x] Docs and smoke coverage state that config, MCP, plugin, app connector, and Browser fallback cannot enable or bypass real GitHub mutation.

**Verification:**
- [x] `npm test -- --run tests/e2e/execute-action.test.ts tests/unit/execution/github-pr-adapter.test.ts tests/unit/integrations/github`
- [x] `npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `node dist/cli/index.js --help`
- [x] `npm test`

**Closure note:** Task 35C adds explicit CLI-only real GitHub mutation opt-in for `execute-action create_pr` and `merge_pr`. It does not add config-based real mutation defaults, MCP/plugin/app mutation helpers, Browser fallback mutation, live credentialed smoke, marketplace/app registration, or release behavior.

**Dependencies:** Task 35B

**Files likely touched:**
- `src/cli/index.ts`
- `src/cli/commands/execute-action.ts`
- `src/execution/adapters/github-pr-adapter.ts`
- `src/index.ts`
- `tests/e2e/execute-action.test.ts`
- `tests/smoke/plugin.test.ts`
- `README.md`
- `docs/configuration.md`
- `docs/github-read-adapter.md`
- `docs/github-mutation-adapter.md`
- `docs/workflows/claude-codex-loop.md`
- `docs/plugin.md`
- `docs/mcp.md`
- `docs/app-connector.md`
- `docs/examples/configuration-usage.md`
- `docs/examples/github-read-review.md`
- `plugins/codepm/skills/codepm/SKILL.md`
- `ImplementationPlan.md`

**Estimated scope:** Medium

### Task 35D: Real GitHub mutation usage docs and optional live smoke guide

**Description:** Document the user-facing real GitHub mutation paths added in 35C, add copyable examples, and keep optional live mutation smoke as a manual credentialed procedure outside the default test suite.

**Acceptance criteria:**
- [x] README links real GitHub mutation usage to `docs/github-mutation-adapter.md` and `docs/examples/github-mutation-execution.md`.
- [x] `docs/examples/github-mutation-execution.md` provides copyable fixture default, real `create_pr`, real `merge_pr`, GitHub Enterprise, JSON/audit, and optional manual live-smoke examples.
- [x] `docs/github-mutation-adapter.md` explains the manual live-smoke boundary and token/env, repo allowlist, expected head SHA, fresh PR gate, and audit redaction checks.
- [x] Smoke coverage confirms docs keep default fixture mode, explicit CLI-only GitHub mutation opt-in, token env only, no raw token examples, and no MCP/plugin/app/Browser mutation bypass.
- [x] No CLI options, config schema, MCP tools, plugin APIs, app connector files, or runtime behavior are changed.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts`

**Closure note:** Task 35D adds documentation, a copyable example guide, smoke coverage, and plan bookkeeping only. It does not run live GitHub mutation, add credentialed tests to the default suite, add config-based real mutation defaults, expose MCP/plugin/app mutation helpers, add Browser fallback mutation, register marketplace/app surfaces, publish, or change release behavior.

**Dependencies:** Task 35C

**Files likely touched:**
- `README.md`
- `docs/github-mutation-adapter.md`
- `docs/examples/github-mutation-execution.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

### Task 36A: Config-based real GitHub mutation defaults design prep

**Description:** Document the future `codepm.config.json` contract for defaulting real GitHub mutation options without changing the active config schema or runtime behavior.

**Acceptance criteria:**
- [x] `docs/github-mutation-config.md` defines future mutation config fields separately from the existing fixture-only `github.adapterMode`.
- [x] The proposed fields cover `github.mutationAdapterMode`, `github.mutationTokenEnv`, `github.mutationAllowedRepos`, `github.mutationApiBaseUrl`, and `github.mutationApiVersion`.
- [x] The design requires exact `owner/name` repo allowlist matching and forbids raw token values in config.
- [x] The design records CLI precedence for `--github-mutation-adapter`, `--github-token-env`, `--github-allowed-repo`, `--github-api-base-url`, and `--github-api-version`.
- [x] Docs state that this is preview only, not active in the current schema, and that `docs/examples/codepm.config.json` intentionally excludes the future mutation fields.
- [x] Smoke coverage confirms the design doc, active config boundary, token/env wording, and no MCP/plugin/app/Browser mutation enablement.

**Verification:**
- [x] `npm test -- --run tests/smoke/plugin.test.ts`

**Closure note:** Task 36A adds design documentation, doc links, smoke coverage, and plan bookkeeping only. It does not change `CodePmConfig`, `loadCodePmConfig`, `execute-action`, MCP tools, plugin APIs, app connector files, or runtime behavior. Actual config schema expansion and `execute-action` effective option wiring remain Task 36B.

**Dependencies:** Task 35D

**Files likely touched:**
- `README.md`
- `docs/configuration.md`
- `docs/github-mutation-adapter.md`
- `docs/github-mutation-config.md`
- `docs/examples/github-mutation-execution.md`
- `tests/smoke/plugin.test.ts`
- `ImplementationPlan.md`

**Estimated scope:** Small

## Checkpoint: MVP Complete

- [x] `review-plan`, `review-diff`, `review-claude-output`, `feedback-for-claude`, `review-pr`, and `execute-action` are implemented.
- [x] Core review engine is usable from CLI and ready for plugin wrapping.
- [x] High-risk actions require scoped human approval.
- [x] Browser fallback is explicitly gated and audited.
- [x] End-to-end scenarios prove the Claude-Codex PM loop.
- [x] MVP closure verification is recorded and all historical plan checkboxes are reconciled.
- [x] Repo-local plugin scaffold passes the plugin-creator validator.

## Vertical Slice Build Order

1. Slice 0, Tasks 1-3: create the runnable CLI skeleton.
2. Slice 1, Tasks 4-8: ship the first useful workflow, `review-plan`.
3. Slice 2, Tasks 9-12: add local implementation review with `review-diff`.
4. Slice 3, Tasks 13-15: add Claude CLI transcript ingestion and feedback loop.
5. Slice 4, Tasks 16-18: add read-only GitHub PR gate with `review-pr`.
6. Slice 5, Tasks 19-23: add scoped approval and controlled execution with `execute-action`.
7. Slice 6, Tasks 24-29: add Browser fallback guardrails, config, E2E workflows, plugin wrapper, MVP closure, and plugin validation.
8. Slice 7, Tasks 30A-30C: add a review-only Codex MCP stdio connector, guarded local diff review, and local packaging docs.
9. Slice 8, Tasks 31A-31E: add and document read-only real GitHub PR reads across CLI, config, plugin, and MCP surfaces.
10. Slice 9, Tasks 32A-32B: prepare local package metadata, package contents, dry-run packaging, tarball smoke, and release readiness checks.
11. Slice 10, Task 33A: prepare Codex marketplace documentation, example entry, and registration-boundary smoke coverage.
12. Slice 11, Task 34A: prepare app connector documentation and no-connector boundary smoke coverage.
13. Slice 12, Tasks 35A-35D: prepare real GitHub mutation safety design, add a mocked HTTP low-level REST mutation adapter, wire explicit CLI-only `execute-action` opt-in, and document copyable/manual usage while keeping config/MCP/plugin/app mutation surfaces closed.
14. Slice 13, Task 36A: design future config-based real GitHub mutation defaults while keeping the active schema and runtime unchanged.

## Parallelization Opportunities

Safe to parallelize after Task 3:

- Parser fixture creation and formatter fixture creation.
- Risk classifier tests and audit writer tests.
- Documentation examples and CLI help text.

Safe to parallelize after Task 12:

- Claude transcript fixtures.
- GitHub fixture states.
- Config schema design.

Must be sequential:

- Policy decision engine depends on parser and risk classifier.
- Diff review depends on local git read adapter.
- `review-pr` depends on the GitHub read model.
- Execution adapters depend on approval evidence and execution preflight.
- Browser fallback depends on execution guardrails.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Markdown parsing is brittle | Medium | Require stable section names and maintain parser fixtures for common Claude output. |
| Claude output is too free-form | Medium | Normalize only structured blocks and ask Claude for a corrected format when ambiguous. |
| Risk classifier under-blocks dangerous work | High | Default unknown production, destructive, or credential-like work to high risk. |
| Risk classifier over-blocks useful work | Medium | Return reasons and allow scoped human approval rather than weakening rules. |
| GitHub state is stale before merge | High | Re-check PR state, head SHA, CI, and review threads during execution preflight. |
| Execution uses a broad approval | High | Scope approval to repo, branch, PR, action, expected head SHA, and timestamp. |
| Browser use performs unintended mutation | High | Require explicit user approval and audit the intended action before any browser operation. |
| Audit logs expose secrets | High | Redact secret-like values before formatting decisions, feedback, and logs. |
| Project grows into a dashboard too early | Medium | Keep MVP CLI-first and gate-focused before adding UI or broad automation. |

## Resolved MVP Decisions and Post-MVP Backlog

1. MVP uses `npm` with a local TypeScript/Node CLI.
2. GitHub reads are adapter-based; fixture-backed tests remain deterministic, and real read-only GitHub PR review is available through explicit CLI/config/plugin/MCP opt-in.
3. Decisions are emitted as Markdown or JSON and consumed from explicit files by follow-up commands.
4. Local human approval is represented as explicit JSON evidence for guarded execution.
5. `push_branch` can execute through guarded local git; PR creation and merge default to fixture mode and support explicit CLI-only real GitHub mutation opt-in through `execute-action`.
6. Browser fallback is implemented as an explicitly approved, audited fallback policy and is not silently callable from review-only commands.
7. Local package readiness is covered by dry-run and install-style tarball smoke checks while actual publishing remains disabled by `private: true`.
8. Marketplace packaging prep is documented and smoke-tested; actual marketplace registration remains a future human-gated task.
9. App connector prep is documented and smoke-tested; actual connector creation and registration remain future human-gated work.
10. Real GitHub mutation adapter design, low-level REST adapter, explicit CLI-only `execute-action` opt-in, copyable usage examples, optional manual live-smoke guidance, and future config default design are documented and smoke-tested.
11. Post-MVP work: Task 36B actual config schema and `execute-action` wiring for real GitHub mutation defaults, MCP/plugin/app mutation helpers if ever approved, actual app connector creation, actual marketplace registration, actual release distribution, and any actual credentialed live smoke execution.
