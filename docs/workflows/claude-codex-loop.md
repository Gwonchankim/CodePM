# Claude-Codex PM Loop

CodePM is a local PM gate for a workflow where Claude Code performs
implementation work and Codex reviews plans, diffs, PR state, and approved
execution requests.

## Recommended Loop

1. Claude writes a `Claude Work Proposal` before implementation.
2. Codex reviews the proposal with `codepm review-plan`.
3. If CodePM requests changes, paste `feedback-for-claude` output back into
   Claude and ask for a revised proposal.
4. Claude implements only the approved scope.
5. Codex reviews the local diff with `codepm review-diff`.
6. After a PR exists, Codex checks merge readiness with `codepm review-pr`.
7. Mutating actions go through `codepm execute-action`, scoped approval, fresh
   state checks, and audit logging.

## Plan Review

```bash
codepm review-plan docs/examples/claude-work-proposal.md --json > decision.json
codepm feedback-for-claude --decision decision.json
```

An approved plan lets Claude start implementation. It does not approve push,
PR creation, or merge by itself.

## Diff Review

Run diff review from the target git repository:

```bash
codepm review-diff --proposal proposal.md --feedback-for-claude
```

CodePM compares the working tree against the configured base ref, checks that
changed files match the proposal, blocks secret-like values, and applies
project-sensitive path rules from `codepm.config.json`.

## PR Gate

Choose one PR gate input:

- Fixture state when you want deterministic local review.
- CLI live read when Codex should read current GitHub state directly.
- MCP live read when a Codex integration should call `codepm_review_pr_github`.

Fixture state is the default:

```bash
codepm review-pr \
  --proposal tests/fixtures/proposals/merge-pr-plan.md \
  --state tests/fixtures/github/passing-pr.json \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123passing \
  --required-check test
```

To read live GitHub PR state, opt in explicitly and provide a token through the
environment:

```bash
GITHUB_TOKEN=... codepm review-pr \
  --adapter github \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123passing \
  --required-check test
```

To make live reads the project default, set
`github.prReadAdapterMode: "github"` in `codepm.config.json`. To review through
MCP, call `codepm_review_pr_github` with `tokenEnv: "GITHUB_TOKEN"`. MCP and
plugin paths are read-only and cannot merge, comment on, or mutate the PR.

The gate blocks stale head SHAs, failing required checks, draft or unmergeable
state, missing reviews when required, and unresolved review threads.

## Guarded Execution

`execute-action` is the only user-facing execution command. It accepts an
approved decision plus either reviewed scope or approval evidence, then runs
preflight before touching local git, fixture GitHub adapters, or explicit real
GitHub mutation adapters.

```bash
codepm execute-action \
  --action create_pr \
  --decision decision.json \
  --risk low \
  --scope reviewed-scope.json \
  --proposal docs/examples/create-pr-proposal.md \
  --repo octo/example \
  --base-ref main \
  --head-ref feature/local-doc-note \
  --title "Add local documentation note" \
  --body body.md \
  --expected-head-sha abc123passing \
  --github-result tests/fixtures/github/create-pr-result.json
```

The default GitHub mutation path is fixture mode. To perform a real GitHub PR
creation or merge, opt in explicitly for one execution and provide token env,
repo allowlist, expected head SHA, and the normal preflight inputs:

```bash
codepm execute-action \
  --action merge_pr \
  --decision decision.json \
  --risk medium \
  --approval approval.json \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123passing \
  --required-check test \
  --github-mutation-adapter github \
  --github-token-env GITHUB_TOKEN \
  --github-allowed-repo octo/example
```

Real local `git push` is supported only through `push_branch` after preflight
allows the exact requested scope. Config, MCP, plugin, app connector, and
Browser fallback paths do not enable or bypass real GitHub mutation. See
[`docs/github-mutation-adapter.md`](../github-mutation-adapter.md).

## Audit Trail

Review commands write audit only when `--audit-log` is provided. Execution
commands use `defaults.auditLogPath` from `codepm.config.json` unless
`--audit-log` overrides it.
