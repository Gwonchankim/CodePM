# Claude Work Proposal

## Goal

Open a fixture-backed PR for a small documentation note.

## Context

CodePM needs a safe example for exercising guarded PR creation without calling
the GitHub network.

## Proposed Changes

- Add a local documentation note for the CodePM PM loop.

## Files Expected To Change

- `docs/examples/local-doc-note.md`

## Risk Assessment

- Risk Level: low
- Risk Areas:
  - documentation

## Test Plan

- Run `npm test -- --run tests/unit/config`.

## Commands To Run

```bash
npm test -- --run tests/unit/config
```

## Requested Action

create_pr

## Rollback Plan

Remove the documentation note before retrying.

## Open Questions

- None.
