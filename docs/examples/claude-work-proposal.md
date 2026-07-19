# Claude Work Proposal

## Goal

Add the first local CodePM review flow that can validate a Claude proposal before implementation starts.

## Context

The current product spec defines CodePM as a PM gate between Claude Code, Codex, GitHub, and the user. The MVP starts with local Markdown proposals before GitHub automation.

## Proposed Changes

- Add a parser for the required Claude proposal sections.
- Add validation errors for missing required sections.
- Add fixture proposals for valid and invalid examples.
- Add unit tests for proposal parsing.

## Files Expected To Change

- `src/parser/`
- `tests/unit/parser/`
- `tests/fixtures/proposals/`
- `docs/schema.md`

## Risk Assessment

- Risk Level: low
- Risk Areas:
  - local tooling
  - parser behavior
  - test fixtures

## Test Plan

- Run parser unit tests.
- Verify a complete proposal parses successfully.
- Verify missing required sections produce actionable errors.
- Verify unknown extra sections do not fail parsing.

## Commands To Run

```bash
npm test -- --run tests/unit/parser
```

## Requested Action

plan_review

## Rollback Plan

Revert parser and fixture files if the contract is wrong. No production state, GitHub state, or user data is affected.

## Open Questions

- Should parser output preserve original Markdown section text exactly, or normalize whitespace immediately?
- Should duplicate sections be an error or should the first section win?
