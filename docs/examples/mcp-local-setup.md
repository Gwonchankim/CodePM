# MCP Local Setup Example

Use this sequence when loading the repo-local CodePM plugin in a Codex
environment.

## Build

```bash
npm install
npm run build
node dist/mcp/index.js --help
```

## Allow Local Diff Roots

Windows PowerShell:

```powershell
$env:CODEPM_MCP_ALLOWED_ROOTS = "C:\Users\amole\Desktop\CodePM;C:\work\project"
node dist/mcp/index.js
```

POSIX shell:

```bash
export CODEPM_MCP_ALLOWED_ROOTS="/home/me/CodePM:/work/project"
node dist/mcp/index.js
```

`codepm_review_diff` can only read `cwd` and `configPath` values under the
allowed roots. Other MCP tools remain review-only and do not need local git
access.

## Plugin Path

The repo-local plugin directory is:

```text
plugins/codepm
```

Its `.mcp.json` uses:

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

Build CodePM before loading the plugin so `dist/mcp/index.js` exists.

## Validate

```bash
npm test -- --run tests/smoke/plugin.test.ts tests/smoke/mcp-server.test.ts
npm run typecheck
npm run build
node dist/mcp/index.js --help
```

Run `validate_plugin.py plugins/codepm` with a temporary PyYAML target as
documented in `docs/plugin.md`.

Mutation remains outside MCP: use `codepm execute-action` for guarded execution.
