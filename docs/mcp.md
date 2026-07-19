# CodePM MCP Connector

CodePM provides a local stdio MCP server for Codex integrations. The connector
is review-only: it exposes proposal review, local diff review with an explicit
cwd allowlist, fixture-based PR readiness review, real read-only GitHub PR
review, and capability discovery. It does not expose push, PR creation, merge,
or Browser fallback.

## Install And Build

Install dependencies and build the TypeScript package:

```bash
npm install
npm run build
```

The build creates the `codepm-mcp` package bin at `dist/mcp/index.js`.

```bash
node dist/mcp/index.js --help
```

Running without flags starts the stdio MCP server:

```bash
node dist/mcp/index.js
```

Local diff review reads git working tree state. By default it only allows cwd
paths under the CodePM package root. To review another project, set
`CODEPM_MCP_ALLOWED_ROOTS` before starting the MCP server. Use the platform path
delimiter for multiple roots (`;` on Windows, `:` on POSIX):

```powershell
$env:CODEPM_MCP_ALLOWED_ROOTS = "C:\Users\amole\Desktop\CodePM;C:\work\project"
node dist/mcp/index.js
```

```bash
export CODEPM_MCP_ALLOWED_ROOTS="/home/me/CodePM:/work/project"
node dist/mcp/index.js
```

For a copyable local setup sequence, see
[`docs/examples/mcp-local-setup.md`](examples/mcp-local-setup.md).

## Plugin Wiring

The repo-local Codex plugin lives at `plugins/codepm/`. Its manifest points to
`plugins/codepm/.mcp.json`, which declares one local `codepm` server:

```json
{
  "mcpServers": {
    "codepm": {
      "command": "node",
      "args": ["../../dist/mcp/index.js"]
    }
  }
}
```

Build CodePM before loading the plugin so the `dist/mcp/index.js` target exists.
The `.mcp.json` command uses `node ../../dist/mcp/index.js`; that relative path
is intended to resolve from the repo-local plugin directory `plugins/codepm`.

## Tools

### `codepm_review_proposal`

Input:

```json
{
  "proposalMarkdown": "# Claude Work Proposal\n..."
}
```

The tool calls `reviewProposalForClaude`. It returns the full
`CodePmPluginReviewResult` as structured content and returns
`feedbackMarkdown` as text content.

### `codepm_review_pr_fixture`

Input:

```json
{
  "proposalMarkdown": "# Claude Work Proposal\n...",
  "prState": {
    "repo": "octo/example",
    "prNumber": 42,
    "title": "Example PR",
    "body": "Fixture body",
    "baseRef": "main",
    "headRef": "feature/example",
    "headSha": "abc123",
    "changedFiles": ["src/example.ts"],
    "checks": [],
    "reviews": [],
    "reviewThreads": [],
    "unresolvedThreads": [],
    "mergeability": {
      "state": "mergeable",
      "isDraft": false,
      "canMerge": true
    },
    "readAt": "2026-05-25T00:00:00.000Z"
  },
  "expectedHeadSha": "abc123",
  "requiredCheckNames": ["test"]
}
```

The server builds a one-shot fixture `GitHubReadAdapter` from `prState` and
reviews `{ repo: prState.repo, prNumber: prState.prNumber }` with
`reviewPullRequestForClaude`.

### `codepm_review_pr_github`

Input:

```json
{
  "proposalMarkdown": "# Claude Work Proposal\n...",
  "repo": "octo/example",
  "prNumber": 42,
  "expectedHeadSha": "abc123",
  "requiredCheckNames": ["test"],
  "tokenEnv": "GITHUB_TOKEN",
  "apiBaseUrl": "https://api.github.com",
  "apiVersion": "2022-11-28"
}
```

The tool reads a GitHub token from the named environment variable and uses the
read-only GitHub adapter to fetch PR state. It does not accept raw token values
as tool input and does not return token values in structured content or
feedback. If the env var is missing or empty, the tool returns an
`adapter_error` block result before making a fetch call.

`apiBaseUrl` and `apiVersion` are optional overrides for GitHub Enterprise or
API version pinning. This MCP tool does not read `codepm.config.json`; CLI
`review-pr` remains the config-aware path.

Use `codepm_review_pr_fixture` when PR state is already supplied by another
trusted source. Use `codepm_review_pr_github` when the MCP server should perform
an external read-only GitHub API request itself.

### `codepm_review_diff`

Input:

```json
{
  "proposalMarkdown": "# Claude Work Proposal\n...",
  "cwd": "C:\\work\\project",
  "baseRef": "main",
  "configPath": "codepm.config.json"
}
```

The tool enforces `CODEPM_MCP_ALLOWED_ROOTS` before reading config, parsing the
proposal, or running git inspection. Relative `configPath` values are resolved
from `cwd`, and the resolved config path must also be under an allowed root.

`baseRef` overrides `defaults.baseRef` from config. Config
`review.maxChangedFiles` and `review.additionalSensitivePaths` are applied the
same way as CLI `review-diff`. The tool returns plugin-style structured content
and Claude-facing feedback text.

### `codepm_capabilities`

Input: none.

The tool returns `CODEPM_PLUGIN_CAPABILITIES` plus MCP safety metadata,
including `supportsExecutionMutation: false` and
`supportsRealGitHubPullRequestReview: true`.

## Safety Boundary

MCP tools are read-only hints and review results. They are not execution
permission. Mutating actions must continue through:

```bash
codepm execute-action ...
```

That CLI path performs execution preflight, scope comparison, approval checks,
secret scanning, and audit logging. MCP does not call `execute-action`, local
git push, GitHub mutation adapters, or Browser fallback.
The explicit CLI GitHub mutation mode
`execute-action --github-mutation-adapter github` exists, but MCP does not
expose it. Future mutation work must not add an MCP, plugin, app connector, or
Browser fallback bypass around `execute-action`; see
[`docs/github-mutation-adapter.md`](github-mutation-adapter.md).

MCP `codepm_review_diff` is read-only and does not write audit logs. It only
reads local git/config state after cwd and config paths pass the allowed-roots
policy.

MCP `codepm_review_pr_github` may perform external GitHub reads, but it remains
read-only and does not create, update, merge, label, comment on, or otherwise
mutate GitHub resources.

For copyable CLI, config, MCP, plugin, GitHub Enterprise, and optional manual
live-smoke examples, see
[`docs/examples/github-read-review.md`](examples/github-read-review.md).
