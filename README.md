# CodePM

CodePM is a local PM gate and orchestration CLI for Claude Code and Codex
development workflows. Claude proposes and implements changes; Codex uses
CodePM to review plans, inspect local diffs, check PR readiness, and execute
approved scoped actions through guarded adapters.

## Quick Start

```bash
npm install
npm run build
node dist/cli/index.js --help
```

For local development, run the TypeScript CLI directly:

```bash
npm run dev -- review-plan docs/examples/claude-work-proposal.md
```

## Core Commands

| Command | Purpose |
| --- | --- |
| `review-plan <proposal.md>` | Review a Claude Work Proposal before implementation. |
| `feedback-for-claude --decision <decision.json>` | Convert a CodePM decision into Claude-facing feedback. |
| `review-diff --proposal <proposal.md>` | Review local git changes against the approved scope. |
| `review-pr --repo <repo> --pr <number>` | Check whether a PR is ready for merge using fixture state by default or `--adapter github` opt-in. |
| `execute-action` | Execute one approved action after scoped preflight. |

## Workflow

The recommended loop is documented in
[`docs/workflows/claude-codex-loop.md`](docs/workflows/claude-codex-loop.md).
In short:

1. Claude writes a proposal.
2. Codex runs `review-plan`.
3. Claude implements only approved scope.
4. Codex runs `review-diff`.
5. Codex checks PR readiness with `review-pr`.
6. Mutating actions go through `execute-action`.

## Configuration

Project config is optional. Start with the copyable example:

```bash
cp docs/examples/codepm.config.json codepm.config.json
```

See [`docs/configuration.md`](docs/configuration.md) for discovery,
precedence, audit defaults, fixture-only config mutation adapter mode, and
read-only PR adapter defaults.
Future config-based real GitHub mutation defaults are documented as a design
preview in [`docs/github-mutation-config.md`](docs/github-mutation-config.md);
they are not active in the current config schema.

## Real GitHub PR Review

PR review is fixture-based by default. To read live GitHub state for one run,
use:

```bash
GITHUB_TOKEN=... codepm review-pr --adapter github --proposal proposal.md --repo owner/name --pr 42
```

Project config can make that read adapter the default with
`github.prReadAdapterMode: "github"`. The MCP tool `codepm_review_pr_github`
and plugin helper `reviewPullRequestFromGitHubForClaude` provide the same
read-only review path for Codex integrations. These paths read PR state only;
mutation still goes through `codepm execute-action`.

See [`docs/examples/github-read-review.md`](docs/examples/github-read-review.md)
for copyable CLI, config, MCP, plugin, and optional live-smoke examples.

Real GitHub PR creation and merge are available only through explicit
`codepm execute-action --github-mutation-adapter github` opt-in with token env,
repo allowlist, expected head SHA, execution preflight, and audit logging. The
default remains fixture mode. See
[`docs/github-mutation-adapter.md`](docs/github-mutation-adapter.md) and the
copyable examples in
[`docs/examples/github-mutation-execution.md`](docs/examples/github-mutation-execution.md).

## Codex Plugin / MCP

The repo-local Codex plugin lives at `plugins/codepm`. Build before loading it so
the MCP entrypoint exists:

```bash
npm install
npm run build
node dist/mcp/index.js --help
```

For MCP local diff review, allow the target project root before starting the
server:

```powershell
$env:CODEPM_MCP_ALLOWED_ROOTS = "C:\Users\amole\Desktop\CodePM"
node dist/mcp/index.js
```

The MCP tools are review-only. Push, PR creation, merge, and other mutations
must still go through `codepm execute-action`.

See [`docs/mcp.md`](docs/mcp.md) and
[`docs/examples/mcp-local-setup.md`](docs/examples/mcp-local-setup.md). For
live PR reads through MCP, use `codepm_review_pr_github` with a token env var.
App connector integration prep is documented in
[`docs/app-connector.md`](docs/app-connector.md); actual connector creation and
registration are future work.
Marketplace packaging prep is documented in
[`docs/marketplace.md`](docs/marketplace.md); actual marketplace registration is
still a future human-gated task.

## Package Readiness

CodePM is package-ready for local tarball inspection, but `private: true` keeps
accidental npm publishing disabled. Check the package contents with the
workspace-local npm cache before release work:

```bash
npm run pack:dry-run
npm run pack:smoke
npm run release:check
```

The dry run includes built `dist/` output, README, docs, and the repo-local
plugin scaffold. Source, tests, dependencies, temp directories, and env files
are excluded by the package allowlist. See [`docs/release.md`](docs/release.md)
for the local release preflight and publish boundary.

## Safety Model

- Secret scanning cannot be disabled by project config.
- Medium and high risk mutations require scoped human approval.
- Execution preflight compares reviewed scope with fresh state before mutation.
- `review-pr --adapter github` is read-only and requires a token env.
- GitHub mutation defaults to fixture mode; real network mutation is available
  only through explicit `execute-action --github-mutation-adapter github` CLI
  flags.
- Config, MCP, plugin, app connector, and Browser fallback cannot enable or
  bypass GitHub mutation.
- Browser fallback for GitHub mutation stays explicitly gated and high risk.
- Future GitHub mutation expansion must satisfy the safety requirements in
  [`docs/github-mutation-adapter.md`](docs/github-mutation-adapter.md).

## Verification

```bash
npm test
npm run typecheck
npm run build
npm run pack:dry-run
npm run pack:smoke
```

Optional credentialed GitHub mutation smoke checks are manual only; see
[`docs/examples/github-mutation-execution.md`](docs/examples/github-mutation-execution.md).
