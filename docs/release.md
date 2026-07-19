# CodePM Release Runbook

CodePM is currently release-prepared for local package inspection, not public
publishing. The package keeps `private: true` and `license: "UNLICENSED"` so an
accidental `npm publish` is blocked.

## Local Release Preflight

Run the local checks from the repository root:

```bash
npm run typecheck
npm run build
npm test
npm run pack:dry-run
npm run pack:smoke
```

Or run the full release gate:

```bash
npm run release:check
```

`pack:dry-run` inspects the allowlisted tarball contents. `pack:smoke` creates a
real local tarball under `.tmp-codepm-tests/package-smoke/`, extracts it into a
temporary consumer, runs the packaged CLI and MCP help entrypoints, imports
`CODEPM_PLUGIN_CAPABILITIES` through package exports, and checks that source,
tests, temp directories, and env files were not included.

## Plugin Validator

After changing plugin or MCP packaging files, also run the Codex plugin
validator with the temporary PyYAML target:

Command summary: `validate_plugin.py plugins\codepm`.

```powershell
& "C:\Users\amole\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  -m pip install PyYAML --target ".tmp-codepm-tests\task29-pyyaml"

$env:PYTHONPATH = ".tmp-codepm-tests\task29-pyyaml"
& "C:\Users\amole\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  "C:\Users\amole\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" `
  "plugins\codepm"
```

## Publish Boundary

Do not run `npm publish` for the current package. Before public or private
registry publication is enabled, complete a separate release task that explicitly
handles the version bump, changelog, registry target, release tag, credentials,
and rollback notes.
