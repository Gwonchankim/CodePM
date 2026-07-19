# GitHub Read Review Example

Use this guide when you want CodePM to review real GitHub PR state without
using any GitHub mutation path.

## CLI One-Off

```bash
GITHUB_TOKEN=... codepm review-pr \
  --adapter github \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --expected-head-sha abc123passing \
  --required-check test
```

`review-pr --adapter github` reads PR metadata, changed files, reviews, checks,
statuses, and review threads. It does not create, update, approve, comment on,
or merge the PR.

## Config Default

```json
{
  "schemaVersion": "codepm.config.v1",
  "github": {
    "adapterMode": "fixture",
    "prReadAdapterMode": "github",
    "prReadTokenEnv": "GITHUB_TOKEN",
    "prReadApiBaseUrl": "https://api.github.com",
    "prReadApiVersion": "2022-11-28"
  }
}
```

With that config, `review-pr` can use the GitHub read adapter without passing
`--adapter github` every time. `github.adapterMode` remains fixture-only for
execution mutation adapters.

## MCP Tool Input

```json
{
  "proposalMarkdown": "# Claude Work Proposal\n...",
  "repo": "octo/example",
  "prNumber": 42,
  "expectedHeadSha": "abc123passing",
  "requiredCheckNames": ["test"],
  "tokenEnv": "GITHUB_TOKEN",
  "apiBaseUrl": "https://api.github.com",
  "apiVersion": "2022-11-28"
}
```

Call this through `codepm_review_pr_github`. The tool reads the credential from
the named environment variable. Do not place a raw credential value in MCP
input.

## Plugin Wrapper

```ts
const result = await reviewPullRequestFromGitHubForClaude({
  proposalMarkdown,
  locator: { repo: "octo/example", prNumber: 42 },
  tokenEnv: "GITHUB_TOKEN",
  expectedHeadSha: "abc123passing",
  requiredCheckNames: ["test"]
});
```

The wrapper returns the same `codepm.plugin.v1` result shape as fixture PR
review. Missing credential environment variables return `adapter_error` before
any fetch call.

## GitHub Enterprise

```bash
GITHUB_TOKEN=... codepm review-pr \
  --adapter github \
  --proposal proposal.md \
  --repo octo/example \
  --pr 42 \
  --github-api-base-url https://github.enterprise.test/api/v3 \
  --github-api-version 2022-11-28
```

Use the matching `apiBaseUrl` and `apiVersion` fields for MCP and plugin calls.

## Optional Manual Live Smoke

This check is intentionally manual and credentialed. It is not part of the
default test suite.

```bash
npm run build
GITHUB_TOKEN=... node dist/cli/index.js review-pr \
  --adapter github \
  --proposal proposal.md \
  --repo owner/name \
  --pr 42 \
  --expected-head-sha <current-head-sha> \
  --required-check test \
  --json
```

Treat the result as review evidence only. Mutation remains outside MCP and
plugin helpers; use `codepm execute-action` for guarded execution.
