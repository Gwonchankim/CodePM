# CodePM Spec

## 1. Product Summary

CodePM is a local AI project-management and orchestration gate for development workflows where Claude Code performs implementation work and Codex acts as the PM. Codex reviews Claude's plans, code changes, GitHub action requests, and merge readiness, then sends actionable feedback back to Claude or performs approved GitHub actions through controlled adapters.

The core idea is not to let one AI agent blindly approve another AI agent. CodePM exists to turn AI-generated development work into explicit, reviewable units with requirements, risk assessment, test evidence, and human-controlled approval points.

## 2. Objective

Build a lightweight PM layer that sits between:

- Claude Code, which proposes plans and writes code
- Codex, which acts as PM by reviewing plans, challenging weak proposals, directing revisions, checking implementation evidence, and approving or executing requested actions
- GitHub, which stores branches, pull requests, reviews, checks, and merge state
- The user, who remains the final authority for high-risk or irreversible actions

Success means the user can ask Claude Code to do implementation work, then rely on Codex/CodePM to determine whether the work is clear, scoped, tested, and safe enough to proceed. When the next step is a GitHub action such as push, PR creation, or merge, CodePM verifies the current repository and GitHub state before approving or executing the action.

## 3. Primary Users

- Solo developers using Claude Code and Codex together
- Technical PMs who want an AI-assisted development review loop
- Small teams that want safer AI coding workflows before PR merge
- Engineers who want a repeatable gate for plans, diffs, tests, and GitHub actions

## 4. Core Workflow

### 4.0 PM Orchestration Loop

The primary workflow is a controlled loop between Claude Code and Codex:

1. The user gives Claude Code an implementation request.
2. Claude Code produces a plan, action request, or implementation evidence through the CLI.
3. CodePM ingests the CLI-visible artifact, terminal transcript, or structured Markdown proposal.
4. Codex reviews the submission as PM and returns one of:
   - approval to continue
   - required changes for Claude
   - a block with the reason and next safe action
5. Claude Code revises the plan or performs implementation work based on Codex feedback.
6. CodePM reviews the resulting diff, tests, and GitHub state before allowing the next workflow step.

Codex feedback should be concrete enough that Claude can apply it directly in the CLI without guessing what the PM meant.

### 4.1 Plan Review

Claude Code submits a structured plan before coding.

CodePM reviews:

- Whether the plan matches the user request
- Whether scope is clear and limited
- Whether expected file changes make sense
- Whether risks are named
- Whether the test plan is adequate
- Whether open questions should block implementation

Decision:

- `approve`
- `request_changes`
- `block`

### 4.2 Implementation Review

After Claude Code changes code, CodePM reviews the actual diff.

CodePM checks:

- Diff matches the approved plan
- No unexpected files were changed
- Tests were run and results are provided
- Risk areas were handled properly
- No secrets or dangerous changes are present
- Documentation/spec updates are included when needed

### 4.3 GitHub Action Review

When Claude Code requests push, PR creation, or merge, CodePM acts as a gate and, where explicitly allowed, an action executor.

For push:

- Confirm branch name
- Confirm changed files
- Check for sensitive files or credentials
- Require user approval if risk is not low
- Execute through local git or a GitHub API/connector when approved; Browser use is not the normal push path

For PR creation:

- Validate title and body
- Include summary, test evidence, risk level, and rollback notes
- Link relevant issue/spec when available
- Create the PR only after the generated title/body and diff scope are approved

For merge:

- Confirm CI is green
- Confirm required reviews are satisfied
- Confirm unresolved review threads are resolved
- Confirm diff is within approved scope
- Require human approval for high-risk changes
- Execute merge through the GitHub connector/API when available, or Browser use only as an explicit fallback after user approval

### 4.4 Action Execution

CodePM distinguishes between a decision and an execution:

- A decision explains whether the requested action is allowed.
- An execution performs the approved action through a controlled adapter.

Execution must always re-check fresh state immediately before mutating anything. Merge, push, branch deletion, force push, review dismissal, and production-affecting operations must never be inferred from a previous approval. Each action needs its own scoped approval and audit entry.

Preferred execution order:

1. Read-only local and GitHub inspection.
2. GitHub connector/API or local git command for supported actions.
3. Browser use only when the required GitHub UI action cannot be performed through safer structured interfaces.

## 5. Claude Submission Format

Claude Code should submit work in a consistent Markdown format.

```md
# Claude Work Proposal

## Goal
[What this work is trying to accomplish]

## Context
[Relevant user request, issue, PR, or project context]

## Proposed Changes
[What Claude intends to change]

## Files Expected To Change
- [path/to/file]

## Risk Assessment
- Risk Level: low | medium | high
- Risk Areas:
  - auth/security
  - database
  - billing/payment
  - CI/deployment
  - public API
  - user-facing UI

## Test Plan
[Tests and manual checks Claude expects to run]

## Commands To Run
[Exact commands, if known]

## Requested Action
- plan_review
- implementation_review
- push_branch
- create_pr
- merge_pr

## Rollback Plan
[How to undo or mitigate the change]

## Open Questions
[Unresolved questions or assumptions]
```

## 6. CodePM Decision Format

CodePM should return a structured decision.

```md
# PM Gate Decision

Decision: approve | request_changes | block

## Summary
[Brief decision summary]

## Required Changes
[Required fixes before proceeding]

## Risks
[Remaining risks]

## Verification Required
[Tests, checks, or manual review required]

## Approved Actions
[Actions Claude/user may take next]

## Blocked Actions
[Actions that must not happen yet]
```

## 7. Risk Policy

### Low Risk

Usually eligible for fast approval when the plan and tests are clear.

- Documentation changes
- Test additions
- Small UI copy changes
- Local refactors with no behavior change
- Non-production scripts

### Medium Risk

Requires stronger test evidence and closer review.

- Feature behavior changes
- API request/response changes
- UI flow changes
- Dependency updates
- Test infrastructure changes

### High Risk

Must not be auto-approved.

- Authentication or authorization
- Payment or billing
- Database migration
- Data deletion
- CI/CD deployment configuration
- Production configuration
- Secrets or environment variables
- Public API breaking changes
- Force push, destructive git commands, or direct production operations

## 8. Boundaries

### Always Do

- Review Claude's plan before implementation begins.
- Return actionable PM feedback to Claude when the plan, tests, risk assessment, or requested action is weak.
- Compare implementation diff against the approved plan.
- Require test evidence before PR or merge approval.
- Check CI and unresolved review threads before merge.
- Re-check GitHub state immediately before any merge or other mutation.
- Record why each decision was made.
- Escalate high-risk work to the user.

### Ask First

- Merge a PR.
- Push a branch with medium or high-risk changes.
- Create or update a PR on behalf of Claude.
- Add or upgrade dependencies.
- Change database schema.
- Change CI/CD configuration.
- Modify auth, billing, permissions, or production settings.
- Use Browser use to click GitHub UI actions.

### Never Do

- Commit or push secrets.
- Merge with failing CI.
- Merge with unresolved review threads.
- Hide failing tests by deleting or weakening them.
- Run destructive git commands without explicit user approval.
- Auto-approve high-risk work based only on Claude's confidence.
- Treat Claude's requested GitHub action as permission to execute it.

## 9. Audit Log Requirements

Every major decision should be recorded.

Log fields:

- Timestamp
- Actor
- Requested action
- Decision
- Reason
- Files changed
- Risk level
- Test evidence
- GitHub PR or commit link
- Whether human approval was required
- Whether human approval was granted

## 10. Proposed Project Structure

```txt
CodePM/
  Spec.md
  docs/
    policies/
      pm-gate-policy.md
    examples/
      claude-work-proposal.md
      claude-feedback.md
      pm-gate-decision.md
  src/
    orchestration/
    parser/
    review/
    policy/
    integrations/
      claude-cli/
      github/
      browser/
    execution/
    audit/
  tests/
    fixtures/
    unit/
    integration/
```

## 11. MVP Scope

The first version should focus on a local, file-based workflow.

MVP capabilities:

1. Read a Claude work proposal from Markdown or captured CLI output.
2. Validate required proposal sections.
3. Produce a PM gate decision and Claude-facing feedback.
4. Classify risk level.
5. Review a Git diff against expected files.
6. Check for obvious secret patterns.
7. Require test evidence before PR/merge approval.
8. Generate an audit log entry.
9. Support GitHub PR review checks through connector/API where available.
10. Support approved GitHub action execution through explicit adapters.
11. Use Browser use only as a fallback for UI-only GitHub actions.

## 12. Success Criteria

CodePM MVP is successful when:

- A Claude plan can be reviewed before coding starts.
- Claude receives concrete PM feedback that can be applied in the CLI.
- Codex can return `approve`, `request_changes`, or `block` with clear reasons.
- Implementation diffs are checked against the approved plan.
- High-risk changes are never auto-approved.
- GitHub actions requested by Claude are verified against fresh GitHub state before approval or execution.
- Merge requests are blocked when CI fails.
- Merge requests are blocked when unresolved review threads remain.
- Sensitive files or credential-like changes are flagged.
- Every important decision is written to an audit log.
- The user can understand the next action from the decision output alone.

## 13. Testing Strategy

### Unit Tests

- Proposal parser accepts valid Markdown.
- Proposal parser rejects missing required sections.
- Risk classifier identifies low, medium, and high-risk work.
- Policy engine blocks high-risk auto-approval.
- Secret scanner flags obvious credential patterns.
- Decision formatter produces stable output.

### Integration Tests

- Git diff review detects unexpected files.
- GitHub PR status check handles passing CI.
- GitHub PR status check handles failing CI.
- GitHub PR status check detects unresolved review threads.
- Audit writer records decisions consistently.

### Manual Tests

- Review a real Claude-generated plan.
- Send feedback from CodePM back into a Claude CLI workflow.
- Review a real implementation diff.
- Review a real GitHub PR before merge.
- Execute one approved low-risk GitHub action through a structured adapter in a test repository.
- Confirm Browser use fallback is only used when explicitly approved.

## 14. Open Questions

1. Should the first implementation be a Codex plugin, CLI, or both?
2. Should Claude communicate through Markdown files, captured terminal output, a local IPC bridge, GitHub comments, or a local dashboard?
3. Should low-risk PRs ever be auto-merged, or should every merge require user confirmation?
4. Should audit logs live only in local files, or also be posted to PR comments/check runs?
5. Should project-specific policy be stored in `codepm.config.md`, `codepm.config.json`, or both?
6. How strict should the initial secret scanner be?
7. Should CodePM produce machine-readable JSON decisions in addition to Markdown?
8. Which GitHub mutations should CodePM be allowed to execute directly, and which should remain user-only?

## 15. Recommended First Build

Start with a local CLI or Codex plugin that accepts:

```bash
codepm review-plan ./claude-work-proposal.md
codepm review-diff --proposal ./claude-work-proposal.md
codepm review-pr --repo owner/name --pr 123
codepm execute-action --decision ./pm-gate-decision.json
```

Then expand toward a richer workflow only after the review model proves useful.
