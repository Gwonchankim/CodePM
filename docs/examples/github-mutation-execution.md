# GitHub Mutation Execution Example

Use this guide when you intentionally want CodePM to create or merge a GitHub PR
through the guarded execution path. Fixture mode remains the default. Real
GitHub mutation is available only through explicit
`execute-action --github-mutation-adapter github` CLI flags.
Future config defaults for this opt-in path are only a design preview in
`docs/github-mutation-config.md`; they are not active in the current schema.

Do not pass raw token values to CodePM. Put the credential in an environment
variable and pass only the environment variable name with
`--github-token-env GITHUB_TOKEN`.

## Fixture Default

Fixture mode is still the safest default for tests, dry runs, and recorded PM
workflow examples. It requires `--github-result <fixture.json>`.

```bash
codepm execute-action \
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
  --github-result <fixture.json>
```

## Real `create_pr` Opt-In

Use real PR creation only when the proposal, reviewed scope, expected head SHA,
repo allowlist, and token env are all known.

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
  --github-allowed-repo octo/example \
  --audit-log .codepm/create-pr-audit.jsonl \
  --json
```

GitHub mode forbids `--github-result`. The create path checks the same-repo
head ref before creating the PR, and stale heads are blocked before the create
request.

## Real `merge_pr` Opt-In

Merge is higher risk and requires approval evidence plus at least one required
check. GitHub mode reads PR state, runs preflight, re-reads fresh PR state,
re-runs the PR gate, and only then performs the merge request.

```bash
GITHUB_TOKEN=... codepm execute-action \
  --action merge_pr \
  --decision decision.json \
  --risk medium \
  --approval approval.json \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123 \
  --required-check test \
  --merge-method squash \
  --github-mutation-adapter github \
  --github-token-env GITHUB_TOKEN \
  --github-allowed-repo octo/example \
  --audit-log .codepm/merge-pr-audit.jsonl \
  --json
```

GitHub merge mode forbids `--state` and `--github-result`; it reads current PR
state from GitHub instead. If the second PR read sees a changed head SHA,
failing required check, draft state, unresolved review thread, or blocked
mergeability, CodePM blocks before the merge request.

## GitHub Enterprise

Use API overrides for GitHub Enterprise or pinned API versions:

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
  --github-allowed-repo octo/example \
  --github-api-base-url https://github.enterprise.test/api/v3 \
  --github-api-version 2022-11-28
```

## Optional Manual Live Smoke

This check is intentionally manual and credentialed. It is not part of the
default test suite and should run only against a disposable repository or a
branch prepared for mutation.

1. Build CodePM.
2. Generate or choose a proposal, decision JSON, reviewed scope or approval
   evidence, PR body file, expected head SHA, and audit path.
3. Set `GITHUB_TOKEN` in the shell environment.
4. Run the relevant `execute-action --github-mutation-adapter github` command.
5. Confirm the JSON output has `schemaVersion: "codepm.execution.v1"`, an
   allowed preflight status, mutation metadata, and no token value.
6. Confirm the audit log contains preflight-before-mutation records and no raw
   response body or credential value.

MCP, plugin, app connector, and Browser fallback cannot enable or bypass real
GitHub mutation. They remain review-only or separately gated surfaces; guarded
mutation stays in `codepm execute-action`.
