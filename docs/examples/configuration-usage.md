# CodePM Configuration Usage

This example shows how a project can use `codepm.config.json` without changing
the conservative execution model.

Start from the copyable example:

```bash
cp docs/examples/codepm.config.json codepm.config.json
```

## Review Diff

`review-diff` looks for `codepm.config.json` in the current working directory.
The config default base ref and project sensitive path patterns apply unless
the command overrides them.

```bash
codepm review-diff --proposal docs/examples/claude-work-proposal.md
```

If the diff changes `infra/prod/app.yml` or `.github/workflows/deploy.yml`, the
example config treats that path as sensitive even when the proposal lists it.

To review against a different base ref for one run:

```bash
codepm review-diff --proposal docs/examples/claude-work-proposal.md --base-ref origin/main
```

## Execute Push

`execute-action push_branch` looks for config under `--cwd` when `--config` is
not provided. If `--audit-log` is omitted, audit entries go to the configured
`defaults.auditLogPath`.

```bash
codepm execute-action \
  --action push_branch \
  --decision decision.json \
  --risk low \
  --scope reviewed-scope.json \
  --cwd /path/to/repo \
  --remote origin \
  --branch feature/codepm \
  --base-ref main
```

With the example config in `/path/to/repo/codepm.config.json`, the audit file is
written to `/path/to/repo/.codepm/audit.jsonl`.

## Execute GitHub Fixture Actions

`execute-action create_pr` and `execute-action merge_pr` use
`github.adapterMode`. Version 1 config supports only `fixture`, so fixture runs
require `--github-result <fixture.json>`. Config cannot enable real GitHub
network mutation.

```bash
codepm execute-action \
  --action create_pr \
  --decision decision.json \
  --risk low \
  --scope reviewed-scope.json \
  --config codepm.config.json \
  --proposal proposal.md \
  --repo octo/example \
  --base-ref main \
  --head-ref feature/codepm \
  --title "Add CodePM workflow" \
  --body body.md \
  --github-result tests/fixtures/github/create-pr-result.json
```

To override the configured audit location for one run:

```bash
codepm execute-action \
  --action merge_pr \
  --decision decision.json \
  --risk medium \
  --approval approval.json \
  --config codepm.config.json \
  --proposal proposal.md \
  --state pr-state.json \
  --expected-head-sha abc123 \
  --required-check test \
  --github-result tests/fixtures/github/merge-pr-result.json \
  --audit-log .codepm/manual-merge-audit.jsonl
```

## Execute GitHub Real Mutation Opt-In

For a single guarded real GitHub mutation, opt in with CLI flags instead of
config:

```bash
GITHUB_TOKEN=... codepm execute-action \
  --action create_pr \
  --decision decision.json \
  --risk low \
  --scope reviewed-scope.json \
  --proposal proposal.md \
  --repo octo/example \
  --base-ref main \
  --head-ref feature/codepm \
  --title "Add CodePM workflow" \
  --body body.md \
  --expected-head-sha abc123 \
  --github-mutation-adapter github \
  --github-token-env GITHUB_TOKEN \
  --github-allowed-repo octo/example
```

`merge_pr` GitHub mode also requires `--approval`, `--repo`, `--pr`,
`--expected-head-sha`, and at least one `--required-check`; it reads fresh PR
state from GitHub instead of accepting `--state`.
