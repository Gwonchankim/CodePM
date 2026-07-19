# GitHub Mutation Config Design

This document is a preview only. It is not active in the current
`codepm.config.json` schema. Task 36A records the future config contract for
36B, but real GitHub mutation still requires explicit
`codepm execute-action --github-mutation-adapter github` CLI flags today.

## Design Goal

Project config should be able to provide safe defaults for real GitHub PR
creation and merge without weakening the execution gate. Config may default the
adapter, token environment variable, API endpoint, API version, and exact repo
allowlist. Config must not replace per-action execution evidence such as
approval, expected head SHA, required checks, decision JSON, proposal, scope, or
PR body.

## Proposed Fields

Keep `github.adapterMode` unchanged and fixture-only. Add separate mutation
defaults under `github`:

```json
{
  "github": {
    "adapterMode": "fixture",
    "mutationAdapterMode": "fixture",
    "mutationTokenEnv": "GITHUB_TOKEN",
    "mutationAllowedRepos": [],
    "mutationApiBaseUrl": "https://api.github.com",
    "mutationApiVersion": "2022-11-28"
  }
}
```

- `github.mutationAdapterMode`: `"fixture" | "github"`, default `"fixture"`.
- `github.mutationTokenEnv`: non-empty string, default `"GITHUB_TOKEN"`.
- `github.mutationAllowedRepos`: array of exact `owner/name` repo names,
  default `[]`.
- `github.mutationApiBaseUrl`: non-empty string, default
  `"https://api.github.com"`.
- `github.mutationApiVersion`: non-empty string, default `"2022-11-28"`.

When `github.mutationAdapterMode` is `"github"`,
`github.mutationAllowedRepos` must contain at least one repo. Repo matching is
exact owner/name matching only; wildcards, org-wide patterns, and URL prefixes
are intentionally not supported.

Do not put raw token values in config. Store only the environment variable name
in `github.mutationTokenEnv`.

## CLI Precedence

Future 36B behavior should resolve an effective mutation config before action
preparation:

| Setting | Config default | CLI override |
| --- | --- | --- |
| Mutation adapter | `github.mutationAdapterMode` | `--github-mutation-adapter <fixture|github>` |
| Token env | `github.mutationTokenEnv` | `--github-token-env <ENV_NAME>` |
| Allowed repos | `github.mutationAllowedRepos` | repeated `--github-allowed-repo <owner/name>` |
| API base URL | `github.mutationApiBaseUrl` | `--github-api-base-url <url>` |
| API version | `github.mutationApiVersion` | `--github-api-version <version>` |

CLI precedence means a CLI flag fully overrides the matching config value for
that run. Repeated `--github-allowed-repo` values replace the configured
allowlist for that run.

`--github-result <fixture.json>` is required only when the effective mutation
adapter is `fixture`. It is forbidden when the effective mutation adapter is
`github`.

## Inputs Config Must Not Replace

These remain explicit per execution:

- `--decision <decision.json>`
- `--risk <low|medium|high>`
- `--proposal <proposal.md>`
- `--scope <reviewed-scope.json>` or `--approval <approval.json>`
- `--expected-head-sha <sha>`
- `--required-check <name>` for `merge_pr`
- PR title, body, base ref, head ref, repo, and PR number

In particular, `merge_pr` still requires `--approval`, `--expected-head-sha`,
and at least one `--required-check`; config cannot satisfy those gate inputs.

## Validation Rules For 36B

- Invalid config must exit before proposal reads, fixture reads, GitHub reads,
  or mutation adapter calls.
- `github.adapterMode` remains fixture-only to preserve the existing config
  meaning.
- `github.mutationAdapterMode` must be `fixture` or `github`.
- `github.mutationTokenEnv`, `github.mutationApiBaseUrl`, and
  `github.mutationApiVersion` must be non-empty strings.
- `github.mutationAllowedRepos` must be an array of non-empty exact `owner/name`
  strings.
- If `github.mutationAdapterMode` is `github`, `github.mutationAllowedRepos`
  must contain at least one repo.
- Target repo must be present in the effective allowlist before any network
  request.

## Safety Boundary

This config design must not add a new MCP tool, plugin helper, app connector
action, Browser fallback route, or direct GitHub mutation path. MCP, plugin, app
connector, and Browser fallback cannot enable mutation. Guarded mutation stays
inside `codepm execute-action`, with execution preflight, scoped approval,
fresh PR state checks, and audit logging.

MCP, plugin, app connector, and Browser fallback cannot enable mutation.

## Non-Active Preview

This document is not active yet. The copyable active config example in
`docs/examples/codepm.config.json` intentionally does not include
`github.mutationAdapterMode`, `github.mutationTokenEnv`,
`github.mutationAllowedRepos`, `github.mutationApiBaseUrl`, or
`github.mutationApiVersion`.
