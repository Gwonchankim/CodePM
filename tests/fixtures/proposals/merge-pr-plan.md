# Claude Work Proposal

## Goal

Merge the CodePM GitHub read model PR after PM gate review.

## Context

CodePM needs to confirm GitHub PR readiness before any merge action is allowed.

## Proposed Changes

- Keep the read-only GitHub PR state contract and fixture adapter changes.

## Files Expected To Change

- `src/integrations/github/github-types.ts`
- `src/integrations/github/github-port.ts`

## Risk Assessment

- Risk Level: medium
- Risk Areas:
  - GitHub gate policy

## Test Plan

- Run `npm test -- --run tests/unit/integrations/github tests/unit/review/pr-gate`.

## Commands To Run

```bash
npm test -- --run tests/unit/integrations/github tests/unit/review/pr-gate
```

## Requested Action

merge_pr

## Rollback Plan

Revert the GitHub read model and fixture adapter changes before retrying the merge.

## Open Questions

- None.
