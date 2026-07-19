# CodePM Configuration

CodePM reads optional project configuration from `codepm.config.json`. Missing
configuration uses secure defaults, and project config can only tighten or tune
the local PM gate. It cannot disable secret scanning, scoped approval checks, or
execution preflight.

```json
{
  "schemaVersion": "codepm.config.v1",
  "defaults": {
    "baseRef": "main",
    "auditLogPath": ".codepm/audit.jsonl"
  },
  "review": {
    "maxChangedFiles": 12,
    "additionalSensitivePaths": [
      "infra/prod/**",
      ".github/workflows/**"
    ]
  },
  "github": {
    "adapterMode": "fixture",
    "prReadAdapterMode": "fixture",
    "prReadTokenEnv": "GITHUB_TOKEN",
    "prReadApiBaseUrl": "https://api.github.com",
    "prReadApiVersion": "2022-11-28"
  },
  "safety": {
    "secretScanning": true,
    "highRiskHumanApproval": true
  }
}
```

See `docs/examples/codepm.config.json` for a copyable example.

## Discovery

Config discovery depends on the command:

| Command | Default config location |
| --- | --- |
| `review-diff` | `codepm.config.json` in `process.cwd()` |
| `review-pr` | `codepm.config.json` in `process.cwd()` |
| `execute-action push_branch` | `codepm.config.json` under `--cwd` |
| `execute-action create_pr` | `codepm.config.json` in `process.cwd()` |
| `execute-action merge_pr` | `codepm.config.json` in `process.cwd()` |

Use `--config <path>` to point any config-aware command at a specific file.

## Precedence

Command-line flags are always the most specific source for one run.

| Setting | Config field | Command override |
| --- | --- | --- |
| Config file path | default discovery | `--config <path>` |
| Local review base ref | `defaults.baseRef` | `review-diff --base-ref <ref>` |
| PR read adapter | `github.prReadAdapterMode` | `review-pr --adapter <fixture|github>` |
| PR read token env | `github.prReadTokenEnv` | `review-pr --github-token-env <ENV>` |
| PR read API base URL | `github.prReadApiBaseUrl` | `review-pr --github-api-base-url <url>` |
| PR read API version | `github.prReadApiVersion` | `review-pr --github-api-version <version>` |
| Execution audit log | `defaults.auditLogPath` | `execute-action --audit-log <path>` |

## Defaults

- `defaults.baseRef`: default comparison ref for local diff review.
- `defaults.auditLogPath`: default local JSONL audit log path.

`codepm review-diff --base-ref <ref>` overrides `defaults.baseRef`.
`codepm execute-action --audit-log <path>` overrides
`defaults.auditLogPath`. When `--audit-log` is omitted, `execute-action`
writes audit entries to `defaults.auditLogPath`; relative config paths are
resolved from the config file directory. `review-diff` still writes audit only
when `--audit-log` is provided. `review-pr` also writes audit only when
`--audit-log` is provided.

## Review

- `review.maxChangedFiles`: positive integer limit for broad diff review.
- `review.additionalSensitivePaths`: project-specific sensitive path patterns.

`review.additionalSensitivePaths` supports literal paths, `*` within one path
segment, and `**` across path segments. Matching paths are treated as
`project configured sensitive path` findings.

## GitHub

- `github.adapterMode`: currently supports `fixture`.
- `github.prReadAdapterMode`: read-only PR review adapter, `fixture` or
  `github`.
- `github.prReadTokenEnv`: environment variable used by
  `review-pr --adapter github`.
- `github.prReadApiBaseUrl`: GitHub REST/GraphQL API base URL for read-only PR
  review.
- `github.prReadApiVersion`: GitHub REST API version header for read-only PR
  review.

`execute-action create_pr` and `execute-action merge_pr` use
`github.adapterMode` to choose the mutation adapter. In v1, `fixture` is the
only supported mode and still requires `--github-result <fixture.json>`. No real
GitHub network mutation adapter is enabled by config.

Real GitHub PR creation and merge can be used only as an explicit one-run CLI
opt-in with `codepm execute-action --github-mutation-adapter github`. That mode
requires token env, exact `--github-allowed-repo`, expected head SHA, execution
preflight, and audit logging. Config cannot set or default this real mutation
mode. See `docs/github-mutation-adapter.md` for the safety requirements.

Future config-based real mutation defaults are documented in
`docs/github-mutation-config.md` as a preview only. Those fields are not active
in the current schema and are intentionally absent from
`docs/examples/codepm.config.json`.

`review-pr` uses `github.prReadAdapterMode` for read-only PR state. When set to
`github`, CodePM reads PR metadata, files, reviews, checks, statuses, and review
threads through the read-only GitHub adapter. This does not enable PR creation,
merge, push, Browser fallback, or any other mutation.

## Safety

These safety rules are always enabled:

- Secret scanning cannot be disabled.
- High-risk mutation actions cannot bypass scoped human approval.

Config files that attempt to set `safety.secretScanning` or
`safety.highRiskHumanApproval` to `false` are rejected.

## Invalid Config

Invalid config exits before review or execution work starts. Errors use this
shape:

```text
Invalid CodePM config at /path/to/codepm.config.json

- github.adapterMode: github.adapterMode currently supports only fixture.
```

Common invalid values include an unsupported `schemaVersion`, empty
`defaults.baseRef`, non-string `defaults.auditLogPath`, non-positive
`review.maxChangedFiles`, non-string sensitive path patterns, unsupported
`github.adapterMode`, unsupported `github.prReadAdapterMode`, empty PR read
GitHub settings, or attempts to disable safety settings.
