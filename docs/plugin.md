# CodePM Plugin Wrapper

CodePM exposes a thin plugin-oriented TypeScript wrapper for Codex integrations.
The wrapper calls the same core review engine as the CLI and deliberately avoids
mutation helpers.

## Public API

```ts
import {
  CODEPM_PLUGIN_CAPABILITIES,
  createFixtureGitHubReadAdapter,
  reviewProposalForClaude,
  reviewPullRequestFromGitHubForClaude,
  reviewPullRequestForClaude
} from "codepm";
```

`CODEPM_PLUGIN_CAPABILITIES` advertises the v1 boundary:

```json
{
  "schemaVersion": "codepm.plugin.v1",
  "supportsProposalReview": true,
  "supportsPullRequestReview": true,
  "supportsRealGitHubPullRequestReview": true,
  "supportsExecutionMutation": false
}
```

## Proposal Review

```ts
const result = reviewProposalForClaude({
  proposalMarkdown
});
```

The result includes:

- `schemaVersion: "codepm.plugin.v1"`
- `ok`: true only when the decision is `approve`
- `status`: `approve`, `request_changes`, `block`, or `adapter_error`
- `decision`
- `decisionMarkdown`
- `feedbackMarkdown`

## PR Readiness Review

```ts
const githubAdapter = createFixtureGitHubReadAdapter([recordedPrState]);

const result = await reviewPullRequestForClaude({
  proposalMarkdown,
  locator: { repo: "octo/example", prNumber: 42 },
  githubAdapter,
  expectedHeadSha: "abc123",
  requiredCheckNames: ["test"]
});
```

The wrapper accepts a `GitHubReadAdapter` so Codex plugin code can use fixture
state or a future read-only adapter without changing the review contract.
Adapter read failures return a safe `adapter_error` result with a blocking
decision and Claude-facing feedback.

To use the built-in read-only GitHub adapter, opt in through an environment
variable rather than passing a raw token:

```ts
const result = await reviewPullRequestFromGitHubForClaude({
  proposalMarkdown,
  locator: { repo: "octo/example", prNumber: 42 },
  tokenEnv: "GITHUB_TOKEN",
  expectedHeadSha: "abc123",
  requiredCheckNames: ["test"]
});
```

If the token env var is missing or empty, the helper returns `adapter_error`
before making a fetch call. It does not expose push, PR creation, merge, Browser
fallback, or any other mutation helper.

Use fixture adapters for deterministic tests, and use
`reviewPullRequestFromGitHubForClaude` when plugin code should perform the
external read-only GitHub API request itself. Do not pass raw credential values
through plugin inputs; pass the environment variable name with `tokenEnv`.

## Execution Boundary

The plugin wrapper does not expose push, PR creation, merge, Browser fallback,
or any other mutation helper. Mutating actions must continue through
`codepm execute-action`, which performs execution preflight, scope comparison,
approval checks, secret scanning, and audit logging.
The explicit CLI GitHub mutation mode
`execute-action --github-mutation-adapter github` exists, but the plugin wrapper
does not expose it. Future mutation work must stay behind `execute-action` and
the safety requirements in
[docs/github-mutation-adapter.md](github-mutation-adapter.md).

The repo-local Codex plugin scaffold lives at `plugins/codepm/`. It provides
workflow guidance and a review-only MCP companion file at
`plugins/codepm/.mcp.json`. The MCP server exposes proposal review, local diff
review with `CODEPM_MCP_ALLOWED_ROOTS`, PR fixture review, real read-only
GitHub PR review through `codepm_review_pr_github`, and capability discovery.
It does not register an app connector or marketplace entry in v1.

See [docs/mcp.md](mcp.md) for MCP install, run, and tool contract details.
See [docs/examples/github-read-review.md](examples/github-read-review.md) for
copyable real GitHub read review examples.
See [docs/app-connector.md](app-connector.md) for app connector prep. This repo
does not create `plugins/codepm/.app.json`, and the plugin manifest must not
declare `apps` until a later task creates a real app connector.
See [docs/marketplace.md](marketplace.md) and
[docs/examples/codepm-marketplace.json](examples/codepm-marketplace.json) for
marketplace packaging prep. This is only a preview; do not create or update a
real marketplace entry during local validation.

## Scaffold Validation

Validate the repo-local plugin with the plugin-creator validator before changing
plugin metadata:

```powershell
& "C:\Users\amole\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  -m pip install PyYAML --target ".tmp-codepm-tests\task29-pyyaml"

$env:PYTHONPATH = ".tmp-codepm-tests\task29-pyyaml"
& "C:\Users\amole\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  "C:\Users\amole\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" `
  "plugins\codepm"
```

`PyYAML` is a temporary validator dependency only. Do not add it to
`package.json`, `package-lock.json`, or CodePM runtime dependencies.

## Local Validation Checklist

Run this checklist after changing plugin or MCP packaging docs:

```bash
npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts
npm run typecheck
npm run build
node dist/mcp/index.js --help
npm run pack:dry-run
npm run pack:smoke
```

Then run `validate_plugin.py plugins\codepm` using the temporary PyYAML target
shown above. Confirm the plugin still points to `plugins/codepm/.mcp.json`, the
MCP help lists `codepm_review_diff`, and the docs mention
`CODEPM_MCP_ALLOWED_ROOTS` for local diff review and `codepm_review_pr_github`
for external read-only GitHub PR review. The package dry run should include the
repo-local plugin scaffold under `plugins/codepm/` while excluding source,
tests, temp directories, and env files. The package smoke should prove the
tarball can run the packaged CLI/MCP help entrypoints and import the public
exports from a temporary consumer. Review `docs/marketplace.md` and
`docs/examples/codepm-marketplace.json`, but do not create or update
`.agents/plugins/marketplace.json`. Review `docs/app-connector.md`, but do not
create `plugins/codepm/.app.json` or add `apps` to the plugin manifest.
