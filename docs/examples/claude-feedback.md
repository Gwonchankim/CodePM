# Claude Feedback Example

```md
# PM Feedback For Claude

Decision: request_changes

## Summary

The plan is directionally correct, but it is not ready for implementation because the expected files and test evidence are too vague.

## Required Changes

- List the exact parser files and fixture paths you expect to create or edit.
- State how duplicate Markdown sections should be handled.
- Add parser tests for valid proposals, missing sections, duplicate sections, and unknown extra sections.

## Evidence To Provide Next

- Revised Claude Work Proposal
- Updated Files Expected To Change section
- Updated Test Plan section with the exact test command

## Approved Actions

- Revise the plan.
- Do not start implementation yet.

## Blocked Actions

- Do not edit source files.
- Do not push a branch.
- Do not create or merge a PR.
```

The feedback format should be concise enough to paste back into Claude Code while still being specific enough to remove ambiguity.
