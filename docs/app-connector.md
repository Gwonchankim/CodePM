# CodePM App Connector Integration Prep

CodePM does not ship an app connector yet. The current supported integration
surface is the repo-local plugin + MCP review-only connector. Actual app
connector creation and registration remain future work.

## Current Boundary

- The plugin manifest stays at `plugins/codepm/.codex-plugin/plugin.json`.
- The MCP companion stays at `plugins/codepm/.mcp.json`.
- MCP tools are review-only and report `supportsExecutionMutation: false`.
- Mutating actions still run only through `codepm execute-action`.
- Real GitHub mutation is available only through explicit CLI
  `execute-action --github-mutation-adapter github` flags; the app connector
  does not expose it.

Do not create `plugins/codepm/.app.json` in this prep task. Do not add `apps` to `plugins/codepm/.codex-plugin/plugin.json` until a later task creates a real app manifest.

Actual app connector creation and registration remain future work.

## Required Decisions Before Creation

Before adding an app connector, collect these human-provided values:

- connector id
- owning account/team
- auth policy
- app registration target
- privacy policy URL
- terms of service URL
- homepage URL
- repository URL

The connector task also needs an explicit release and approval path. If the app
connector target requires assets, handle those in the connector creation task,
not in this prep slice.

## Review-Only First

If CodePM later adds an app connector, expose review-only actions first:

- Proposal review
- Local diff review only with an explicit cwd/sandbox policy
- PR readiness review through fixture state or read-only GitHub API reads
- Capability discovery that keeps `supportsExecutionMutation: false`

Do not expose push, PR creation, merge, Browser fallback, or `execute-action` bypass from the app connector. Any mutation-capable app connector behavior must
be designed as a separate human-gated task and must preserve execution
preflight, scoped approval, secret scanning, and audit logging.

## Validation Checklist

Until the connector exists, validation should prove the absence of app connector
surface area:

```bash
npm test -- --run tests/smoke/plugin.test.ts tests/smoke/package-readiness.test.ts
npm run pack:dry-run
npm run pack:smoke
node dist/mcp/index.js --help
```

Then run the plugin validator documented in `docs/plugin.md`. The plugin should
continue to validate without `.app.json` and without an `apps` manifest field.
