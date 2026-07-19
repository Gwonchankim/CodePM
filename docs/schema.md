# CodePM Schema

This document defines the first implementation contracts for CodePM. The CLI may read Markdown, but the review engine should normalize inputs into these shapes before applying policy.

## Proposal

Represents a Claude Work Proposal.

Required Markdown sections:

- `Goal`
- `Context`
- `Proposed Changes`
- `Files Expected To Change`
- `Risk Assessment`
- `Test Plan`
- `Commands To Run`
- `Requested Action`
- `Rollback Plan`
- `Open Questions`

Required normalized fields:

- `goal`: string
- `context`: string
- `proposedChanges`: string
- `filesExpectedToChange`: string[]
- `riskAssessment`: `RiskAssessment`
- `testPlan`: string
- `commandsToRun`: string[]
- `requestedAction`: `RequestedAction`
- `rollbackPlan`: string
- `openQuestions`: string[]

Unknown extra Markdown sections should not break parsing. Duplicate required sections should be validation errors because they make the PM decision ambiguous.

## ActionRequest

Represents the next action Claude asks CodePM to review or execute.

Allowed values:

- `plan_review`
- `implementation_review`
- `push_branch`
- `create_pr`
- `merge_pr`

Common fields:

- `requestedAction`: one allowed action value
- `repo`: optional repository identifier
- `branch`: optional branch name
- `prNumber`: optional pull request number
- `expectedHeadSha`: optional Git commit SHA for scoped approval
- `source`: `proposal`, `diff`, `claude_cli`, or `github`

## Decision

Represents CodePM's PM gate result.

Allowed values:

- `approve`
- `request_changes`
- `block`

Required fields:

- `decision`: one allowed decision value
- `summary`: string
- `requiredChanges`: string[]
- `risks`: string[]
- `verificationRequired`: string[]
- `approvedActions`: string[]
- `blockedActions`: string[]

## ClaudeFeedback

Represents PM feedback intended to be pasted back into Claude Code.

Required fields:

- `decision`: one allowed decision value
- `summary`: string
- `requiredChanges`: string[]
- `evidenceToProvideNext`: string[]
- `approvedActions`: string[]
- `blockedActions`: string[]

The feedback must be concrete. It should name missing files, tests, risk details, or GitHub state instead of using vague review language.

## AuditEntry

Represents one append-only audit log record.

Required fields:

- `timestamp`: ISO-8601 string
- `actor`: string
- `requestedAction`: `RequestedAction`
- `decision`: `Decision`
- `reason`: string
- `filesChanged`: string[]
- `riskLevel`: `low`, `medium`, or `high`
- `testEvidence`: string
- `github`: object or null
- `humanApprovalRequired`: boolean
- `humanApprovalGranted`: boolean or null

Audit entries must redact secret-like values before they are written.
