# CodePM Marketplace Packaging Prep

CodePM is prepared for marketplace packaging review, but it is not registered in
any marketplace yet. Marketplace registration remains a future human-gated task.

## Current Plugin Package

- Repo-local plugin path: `plugins/codepm`
- Marketplace source path: `./plugins/codepm`
- Plugin manifest: `plugins/codepm/.codex-plugin/plugin.json`
- MCP companion: `plugins/codepm/.mcp.json`
- Skill guidance: `plugins/codepm/skills/codepm/SKILL.md`

The plugin remains review-oriented. MCP tools can review proposals, diffs, and
PR readiness, including read-only GitHub PR state. Execution mutation still goes
through `codepm execute-action`.

## Marketplace Entry Defaults

Use the copyable example at `docs/examples/codepm-marketplace.json` as a preview
only. The entry defaults are:

- `policy.installation: "AVAILABLE"`
- `policy.authentication: "ON_INSTALL"`
- `category: "Productivity"`

Do not add `policy.products` unless a later task explicitly chooses product
gating.

## Pre-Registration Checklist

Before actual marketplace registration, confirm human-provided release metadata:

- Homepage URL
- Repository URL
- Privacy policy URL
- Terms of service URL
- Icon, logo, and screenshot assets if the target marketplace requires them
- Release target, owner, and approval path
- Version bump, changelog, and rollback notes

Then rerun the local validation checklist from `docs/plugin.md` and the release
preflight from `docs/release.md`.

App connector requirements are tracked separately in `docs/app-connector.md`.
Actual app connector creation and registration remain future work.

## Boundaries

- Do not register CodePM in a marketplace in this task.
- Do not create or update `.agents/plugins/marketplace.json`.
- Do not modify a personal marketplace file.
- Do not add an app connector.
- Do not add marketplace assets unless a later task supplies final assets.
- Do not run `npm publish`, bump the version, create a release tag, or generate a changelog.
