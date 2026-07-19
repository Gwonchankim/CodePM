---
name: codepm
description: Use the local CodePM PM gate to review Claude Code proposals, implementation diffs, PR readiness, and guarded execution requests.
---

# CodePM Workflow

Use this skill when the user wants Codex to act as PM over Claude Code work in
this repository.

## Review Flow

1. Ask Claude for a `Claude Work Proposal` before implementation.
2. Review the plan with `codepm review-plan <proposal.md>` or the review-only MCP tool `codepm_review_proposal`.
3. Convert decisions for Claude with `codepm feedback-for-claude --decision <decision.json>`.
4. After Claude implements, review local changes with `codepm review-diff --proposal <proposal.md>` or the MCP tool `codepm_review_diff` when the target cwd is under `CODEPM_MCP_ALLOWED_ROOTS`.
5. For PR readiness, use `codepm review-pr` with a GitHub state fixture or configured read adapter, `codepm_review_pr_fixture` when PR state is already provided, or `codepm_review_pr_github` for external read-only GitHub PR review using a token environment variable.
6. For mutation requests, use `codepm execute-action` so execution preflight and audit logging run.

The MCP companion only exposes `codepm_review_proposal`, `codepm_review_pr_fixture`, `codepm_review_pr_github`, `codepm_review_diff`, and `codepm_capabilities`. It does not expose push, PR creation, merge, or Browser fallback.

## Safety Boundaries

- Do not bypass `execute-action` for push, PR creation, or merge.
- Real GitHub PR creation or merge requires explicit `codepm execute-action --github-mutation-adapter github` flags, token env, repo allowlist, expected head SHA, preflight, and audit.
- Do not treat MCP review tools as execution permission; execution still requires `codepm execute-action`.
- Do not pass raw GitHub tokens through MCP inputs; use the configured token environment variable for `codepm_review_pr_github`.
- Do not use MCP `codepm_review_diff` for a cwd outside `CODEPM_MCP_ALLOWED_ROOTS`.
- Do not treat a plan approval as approval to push, create a PR, or merge.
- Do not use browser fallback for GitHub mutation unless the explicit Browser fallback policy allows it.
- Do not disable secret scanning or high-risk human approval through project config.

## Useful Commands

```bash
codepm review-plan docs/examples/claude-work-proposal.md
codepm review-diff --proposal proposal.md --feedback-for-claude
codepm review-pr --proposal proposal.md --repo octo/example --pr 42 --state pr-state.json
codepm execute-action --action create_pr --decision decision.json --risk low --scope reviewed-scope.json
codepm execute-action --action merge_pr --github-mutation-adapter github --github-token-env GITHUB_TOKEN --github-allowed-repo octo/example --decision decision.json --risk medium --approval approval.json --proposal proposal.md --repo octo/example --pr 42 --expected-head-sha abc123 --required-check test
```
