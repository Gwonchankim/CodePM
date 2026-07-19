# GitHub Read Adapter

CodePM includes a read-only GitHub REST/GraphQL adapter for normalizing live PR
state into `GitHubPullRequestState`.

## Public API

```ts
import { createGitHubRestReadAdapter } from "codepm";

const adapter = createGitHubRestReadAdapter({
  token: process.env.GITHUB_TOKEN
});

const result = await adapter.readPullRequest({
  repo: "owner/name",
  prNumber: 42
});
```

The adapter implements the existing `GitHubReadAdapter` port. It does not push,
create PRs, merge PRs, resolve review threads, or call Browser fallback.
Real GitHub PR creation and merge are separate execution actions and are
available only through explicit `codepm execute-action --github-mutation-adapter
github` CLI opt-in. They are not part of this read adapter. Mutation safety
requirements are tracked in `docs/github-mutation-adapter.md`.

Plugin integrations can call `reviewPullRequestFromGitHubForClaude`, which
constructs this adapter from a token environment variable and returns the same
plugin review result shape as fixture PR review.

## Inputs

- `token`: optional GitHub token. If omitted, public repositories may still be
  readable.
- `apiBaseUrl`: defaults to `https://api.github.com`.
- `apiVersion`: defaults to `2022-11-28`.
- `fetchImpl`: optional injected fetch implementation for tests.

The adapter sends `Authorization: Bearer <token>` only when a token is provided
and sends `X-GitHub-Api-Version` on every request. Error messages must not
include token values or raw response bodies.

## `review-pr` CLI Opt-In

`codepm review-pr` uses fixture mode by default. Live GitHub reads are available
when requested by flag or project config:

```bash
GITHUB_TOKEN=... codepm review-pr \
  --adapter github \
  --proposal proposal.md \
  --repo owner/name \
  --pr 42 \
  --expected-head-sha abc123 \
  --required-check test
```

GitHub mode requires a non-empty token from `GITHUB_TOKEN` by default. To use a
different environment variable, pass `--github-token-env <ENV_NAME>`. Optional
`--github-api-base-url` and `--github-api-version` flags override the adapter
defaults for this command.

Projects can also set these read-only defaults in `codepm.config.json`:

```json
{
  "github": {
    "adapterMode": "fixture",
    "prReadAdapterMode": "github",
    "prReadTokenEnv": "GITHUB_TOKEN",
    "prReadApiBaseUrl": "https://api.github.com",
    "prReadApiVersion": "2022-11-28"
  }
}
```

`review-pr --adapter <fixture|github>` overrides `github.prReadAdapterMode`.
The PR read settings are separate from `github.adapterMode`; the latter remains
fixture-only for execution mutation adapters.

Fixture mode continues to require `--state <github-state.json>` and rejects
GitHub-only flags. GitHub mode rejects `--state` because it reads PR state from
the API. Adapter read failures are returned as safe block decisions and do not
write audit entries unless PR state was read successfully.

## Data Sources

The adapter reads:

- Pull request metadata from REST pull requests.
- Changed files from REST pull request files.
- Reviews from REST pull request reviews.
- Checks from REST check runs and legacy commit status.
- Review threads from GitHub GraphQL `pullRequest.reviewThreads`.

REST pagination follows `Link: rel="next"` where used. GraphQL review threads
use cursor pagination.

Official references:

- https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28
- https://docs.github.com/en/rest/checks/runs
- https://docs.github.com/en/rest/commits/statuses
- https://docs.github.com/rest/pulls/reviews
- https://docs.github.com/graphql/reference
- https://docs.github.com/rest/about-the-rest-api/api-versions/

## Errors

Adapter errors return `GitHubPullRequestReadResult`:

- `401` and non-rate-limit `403`: `unauthorized`
- `404`: `not_found`
- rate-limit, `5xx`, GraphQL errors, invalid JSON, malformed locator, and
  unexpected response shapes: `adapter_error`

All failures are read-only review failures. They do not grant execution
permission.

## Testing And Wiring

Unit tests inject `fetchImpl` and do not use live network calls. The
`review-pr --adapter github` e2e coverage stubs global `fetch`; no live GitHub
network smoke is required.

Still deferred:

- Any live smoke test requiring credentials.
- Config, MCP, plugin, app connector, or Browser fallback mutation wiring.
