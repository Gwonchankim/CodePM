# PM Gate Policy

## Purpose

This policy defines how CodePM reviews work proposed or implemented by Claude Code before Codex allows the workflow to continue or performs an approved action.

CodePM should prefer clear, explainable decisions over hidden automation. A blocked action is acceptable when evidence is missing. A silent unsafe approval or execution is not.

## Decision Levels

### approve

Use when the request is clear, scoped, sufficiently tested, and allowed by policy.

### request_changes

Use when the work is directionally acceptable but missing required detail, evidence, or cleanup.

### block

Use when the requested action is unsafe, out of scope, high-risk without human approval, or contradicted by failing checks.

## Required Proposal Sections

A Claude proposal must include:

- Goal
- Context
- Proposed Changes
- Files Expected To Change
- Risk Assessment
- Test Plan
- Commands To Run
- Requested Action
- Rollback Plan
- Open Questions

Missing required sections should result in `request_changes` unless the requested action is destructive or high-risk, in which case the decision should be `block`.

## Claude Feedback Rules

When CodePM returns feedback to Claude Code, the feedback must be directly actionable in a CLI workflow.

Feedback should include:

- The decision: `approve`, `request_changes`, or `block`
- The specific issues Claude must fix
- The exact evidence Claude should provide next
- Actions Claude may take now
- Actions Claude must not take yet

Feedback should not rely on vague PM language such as "improve the plan" without naming the missing scope, risk, tests, files, or GitHub state.

## Risk Classification

### Low Risk

Low-risk work is usually eligible for approval when the proposal is complete and test expectations are reasonable.

Examples:

- Documentation updates
- New tests that do not weaken existing tests
- Small copy changes
- Local-only refactors without behavior changes
- Non-production helper scripts
- Example fixtures

Default requirement:

- Complete proposal
- Clear files expected to change
- Basic verification plan

### Medium Risk

Medium-risk work requires stronger evidence and should usually require implementation review before push or PR creation.

Examples:

- Feature behavior changes
- UI flow changes
- API request or response changes
- Dependency additions or upgrades
- Test infrastructure changes
- Build tooling changes
- Broad refactors across multiple modules

Default requirement:

- Complete proposal
- Clear rollback plan
- Automated test evidence
- Diff review against expected files
- Human approval before push when uncertainty remains

### High Risk

High-risk work must not be auto-approved.

Examples:

- Authentication or authorization changes
- Payment or billing changes
- Database migration or destructive data operation
- Production configuration changes
- CI/CD deployment changes
- Secrets, credentials, tokens, or environment files
- Public API breaking changes
- Force push
- Merge to protected branches
- Browser use for GitHub UI mutation
- Destructive git commands

Default requirement:

- Complete proposal
- Explicit human approval
- Strong test evidence
- Rollback plan
- Audit log entry
- Fresh GitHub state check before merge

## Requested Action Rules

### plan_review

Approve only when:

- Goal is clear
- Scope is bounded
- Risk level is plausible
- Test plan fits the risk
- Open questions do not block implementation

Request changes when:

- Required sections are missing
- Expected files are vague
- Test plan is too weak
- Risk level appears understated

Block when:

- The plan asks for a destructive or high-risk action without approval
- The goal conflicts with user instructions
- The proposal includes forbidden behavior

### implementation_review

Approve only when:

- Diff matches the approved plan
- Test evidence is present
- Unexpected files are explained
- No secret-like values are present

Request changes when:

- Diff includes unexplained files
- Tests were not run but risk is low or medium
- Documentation/spec updates are missing

Block when:

- Secrets are detected
- High-risk changes lack human approval
- Implementation contradicts the approved plan
- Tests fail and the action requested is push, PR, or merge

### push_branch

Approve only when:

- Branch is appropriate
- Diff has passed implementation review
- No secrets are detected
- Risk is low, or human approval exists for higher risk
- The push target and expected changed files are explicit

Block when:

- Sensitive files or credentials are present
- Branch target is unsafe
- Requested push includes unreviewed high-risk changes
- The branch or remote target is ambiguous

### create_pr

Approve only when:

- PR title and body are accurate
- Test evidence is included
- Risk level and rollback notes are included
- Diff has been reviewed

Request changes when:

- PR description lacks risk, tests, or rollback notes
- Linked spec/issue context is missing but expected

### merge_pr

Approve only when:

- CI is green
- Required reviews are satisfied
- No unresolved review threads remain
- Diff is within approved scope
- Required human approval exists
- Audit log will record the merge decision

Block when:

- CI is failing, pending, missing, or stale
- Required review is missing
- Review threads are unresolved
- High-risk approval evidence is missing
- Secrets are detected
- Base branch is not the expected target

## Secret and Sensitive File Rules

Flag likely secrets without printing full values.

Sensitive examples:

- `.env`
- `.env.*`
- private keys
- API keys
- OAuth client secrets
- database URLs with credentials
- production config files
- deployment credentials

Secret findings should block push and merge actions.

## Browser Use Rules

Browser use is a fallback, not the default.

Browser use may be used only when:

- GitHub connector/API cannot perform the needed inspection or action
- The user explicitly approves the browser action
- The intended action is stated before it occurs
- The result is recorded in the audit log

The approval must name the exact browser fallback action and target. Approval for
one PR, branch, repository, or environment does not carry over to another target.
Review-only commands must never trigger Browser use; Browser fallback belongs
behind execution paths that have already passed PM decision and preflight checks.

Browser fallback audit records must be written in order:

1. `intended`: the exact action, source command, target, approval identity, and
   risk level before any Browser interaction occurs.
2. `observed`: the result observed after the Browser interaction, including the
   resulting URL when available.

If policy blocks Browser fallback, the runner must not be called. A blocked audit
entry may be recorded, but it must not claim that the browser action occurred.

Browser use must not be used silently for:

- Merge
- Force push
- Branch deletion
- Review dismissal
- Production deploy

Push is normally a local git or API operation, not a Browser use operation. If a browser-only workflow appears necessary for a GitHub mutation, CodePM must treat it as high risk and ask the user before acting.

## Execution Rules

A decision is not automatically an execution permission.

CodePM may execute an action only when:

- The action has an explicit `approve` decision.
- The approval is scoped to the same repository, branch, PR, action, and expected head SHA or diff state.
- Fresh local and GitHub state has been checked immediately before execution.
- Required human approval exists for medium-risk or high-risk mutations.
- The execution adapter is named in the audit log.

CodePM must block execution when:

- The decision is stale.
- The repository, branch, PR, or head SHA changed since approval.
- CI, reviews, or unresolved threads changed from passing to unsafe.
- The requested action is broader than the approved action.
- The action would require destructive git commands, force push, branch deletion, or production mutation without explicit scoped approval.

Preferred execution adapters:

- Local git for branch push after local diff and secret checks.
- GitHub connector/API for PR creation, PR metadata updates, and merge.
- Browser use only as an explicitly approved fallback for GitHub UI actions that cannot be completed through structured interfaces.

## Human Approval Rules

Human approval must include:

- Approver identity or local user label
- Timestamp
- Approved action
- Approved scope
- Related PR/branch/proposal

Approval for one action must not imply approval for another action.

Examples:

- Approval to create a PR does not approve merge.
- Approval to merge PR #10 does not approve merging PR #11.
- Approval for a low-risk documentation change does not approve auth changes added later.

## Audit Requirements

Every decision should record:

- Timestamp
- Actor
- Requested action
- Decision
- Reason
- Files changed
- Risk level
- Test evidence
- GitHub PR or commit link when available
- Human approval requirement
- Human approval result
- Execution adapter when an action is performed
- Fresh state check timestamp when an action is performed

Audit logs must redact secret-like values.
