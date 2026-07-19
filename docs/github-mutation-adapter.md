# GitHub Mutation Adapter

CodePM includes a low-level async GitHub REST mutation adapter that is verified
with mocked HTTP tests. It is wired into one user-facing path only:
`codepm execute-action --github-mutation-adapter github`.

The default for `execute-action create_pr` and `execute-action merge_pr` remains
fixture mode and still requires `--github-result <fixture.json>`. Real GitHub
PR creation and merge require explicit CLI opt-in, token env, exact repo
allowlist, expected head SHA, execution preflight, and audit logging.

This document records the current CLI wiring and the safety boundaries that
must remain in place. The adapter does not enable a config setting, MCP tool,
plugin helper, app connector action, or Browser fallback path.

## Current Boundary

- `github.adapterMode` supports only `fixture`.
- `create_pr` and `merge_pr` default to the fixture `GitHubMutationAdapter`.
- `--github-result <fixture.json>` is required for both GitHub mutation actions
  in fixture mode.
- `--github-mutation-adapter github` explicitly opts one `execute-action` run
  into real GitHub REST mutation.
- GitHub mode requires `--github-token-env <ENV_NAME>`, at least one
  `--github-allowed-repo <owner/name>`, and a target repo that exactly matches
  the allowlist before any mutation request is made.
- Real GitHub PR reads are supported separately by `review-pr`,
  `codepm_review_pr_github`, and `reviewPullRequestFromGitHubForClaude`.
- MCP, plugin, and app connector surfaces must not expose push, PR creation,
  merge, Browser fallback, or an `execute-action` bypass.

## Low-Level REST Mutation Adapter

`createGitHubRestMutationAdapter` supports REST calls for
`create_pr` and `merge_pr` wiring. It requires a non-empty token, an exact
`allowedRepos` allowlist, optional API base/version overrides, and an injectable
`fetchImpl` for tests.

The adapter:

- sends GitHub REST headers including `Authorization: Bearer <token>`;
- creates PRs with `POST /repos/{owner}/{repo}/pulls`;
- optionally checks same-repo head refs with
  `GET /repos/{owner}/{repo}/commits/{headRef}` before PR creation;
- merges PRs with `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`;
- maps HTTP and response-shape failures into existing `GitHubMutationResult`
  error codes;
- redacts token values, raw response bodies, and secret-like body content from
  error output.

This adapter is async and intentionally separate from the existing synchronous
`GitHubMutationAdapter` execution port. The CLI uses it only through the async
`execute-action` GitHub opt-in path.

## CLI Opt-In

Use fixture mode unless a real network mutation is intended:

```bash
codepm execute-action \
  --action create_pr \
  --decision decision.json \
  --risk low \
  --scope reviewed-scope.json \
  --proposal proposal.md \
  --repo octo/example \
  --base-ref main \
  --head-ref feature/example \
  --title "Add example" \
  --body body.md \
  --expected-head-sha abc123 \
  --github-mutation-adapter github \
  --github-token-env GITHUB_TOKEN \
  --github-allowed-repo octo/example
```

For merge, GitHub mode reads PR state, runs preflight, re-reads fresh PR state,
re-runs the PR gate, and only then calls the REST merge endpoint:

```bash
codepm execute-action \
  --action merge_pr \
  --decision decision.json \
  --risk medium \
  --approval approval.json \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123 \
  --required-check test \
  --github-mutation-adapter github \
  --github-token-env GITHUB_TOKEN \
  --github-allowed-repo octo/example
```

`--github-result <fixture.json>` is forbidden in GitHub mode. `merge_pr` GitHub
mode also forbids `--state`; it reads current PR state from GitHub instead.

For copyable fixture, real `create_pr`, real `merge_pr`, GitHub Enterprise, and
manual live-smoke examples, see
[`docs/examples/github-mutation-execution.md`](examples/github-mutation-execution.md).
Future config-based defaults for this CLI opt-in path are designed in
[`docs/github-mutation-config.md`](github-mutation-config.md), but they are not
active in the current config schema.

## Safety Requirements

The REST mutation path must keep the existing execution preflight path as the
only execution entrypoint. It requires:

- token env based authentication, never raw token CLI/MCP/plugin inputs;
- least-privilege GitHub token scopes for the specific mutation;
- repo allowlist or exact target repo matching before any network mutation;
- exact action and target matching against the approved proposal;
- expected head SHA verification where the action depends on a branch or PR;
- reviewed scope plus scoped human approval for medium and high risk actions;
- fresh preflight evidence immediately before mutation;
- audit intended and observed records with token values and secret-like content
  redacted;
- typed, redacted adapter errors that never include raw response bodies.

The adapter must not use Browser fallback as an automatic recovery path. Browser
fallback remains a separate high-risk fallback that requires explicit approval,
exact action and target matching, and its own audit trail.

## `create_pr` GitHub Mode

The `create_pr` GitHub mode validates the same inputs that the fixture path
validates: proposal requested action, repository, base ref, head ref, title,
body, reviewed scope, decision, risk, and approval evidence when required.

Before creating the PR, the adapter verifies the target repo is allowed and the
same-repo head ref resolves to the expected head SHA. Fork-style head refs with
expected head SHA are rejected in this first real mutation slice.

Audit output must record the intended repository, base ref, head ref, title
summary, expected head SHA, and the observed PR number/URL/head SHA after the
mutation. It must not record token values or raw API response bodies.

## `merge_pr` GitHub Mode

The `merge_pr` GitHub mode reads PR state through the read-only GitHub adapter
for preflight scope, then re-reads PR state immediately before mutation. The
merge can proceed only when the fresh PR state still satisfies the PR gate:

- the PR head SHA matches the expected head SHA;
- required checks are successful;
- required reviews are still satisfied;
- there are no unresolved review threads;
- the PR is not draft and remains mergeable;
- the merge method is allowed for the repository policy.

Audit output must record the intended repo, PR number, expected head SHA, merge
method, gate evidence, and observed merge result or merge SHA. Failure output
must be typed and redacted.

## Out Of Scope

- Adding `github.adapterMode: "github"` or any other real-network mode.
- Adding config-based real mutation defaults.
- Adding live GitHub mutation smoke tests to the default suite.
- Adding MCP, plugin, app connector, or Browser mutation surfaces.

Future implementation slices may add config-based defaults, credentialed manual
smoke guidance, or release packaging, but they must not bypass `execute-action`
preflight, scoped approval, and audit logging.

## Optional Manual Live Smoke

Live GitHub mutation smoke is intentionally manual and credentialed. It should
run only against a disposable repository or a branch prepared for mutation. Do
not add it to the default test suite.

The manual check should confirm:

- `GITHUB_TOKEN` is supplied by environment variable name, not raw CLI input;
- the target repo is listed with `--github-allowed-repo`;
- `--expected-head-sha` matches the intended branch or PR head;
- `create_pr` blocks stale same-repo head refs before POST;
- `merge_pr` re-reads PR state and blocks stale or failing gates before PUT;
- Markdown/JSON output and audit entries do not include token values or raw
  response bodies.
