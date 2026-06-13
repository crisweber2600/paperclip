# Goal/spec execution loop verification checklist

Use this checklist to review the end-to-end tranche that connects goal review, accepted planning, decomposition, implementation, review evidence, and closure.

## Automated regression anchor

- Run `pnpm vitest server/src/__tests__/issues-service.test.ts --runInBand`.
- Confirm the scenario `carries an accepted plan from planning signal through decomposition, blockers, and closure evidence` passes.
- Confirm the scenario proves all of the following in one persisted flow:
  - an accepted plan revision can be decomposed exactly once into child issues
  - child issues inherit the same company, parent, goal, and assignee context
  - structured blockers persist on decomposed implementation work
  - closure evidence can be attached as a durable work product
  - retrying the same accepted-plan decomposition reuses the original child set instead of duplicating work

## Operator review path

- Open a planning issue with a `plan` document and accept the latest revision through `request_confirmation`.
- Decompose the accepted plan into implementation children.
- Verify each child is company-scoped and inherits the parent issue and goal linkage.
- Verify blocked implementation work uses `blockedByIssueIds` rather than a markdown-only note.
- Verify closure evidence is attached through a work product or uploaded artifact before marking the related issue done.
- Verify the parent thread clearly shows what was intentionally deferred, if anything.

## Intentional gaps

- This checklist does not claim a full browser/UI journey; the regression anchor is service-layer coverage for the control-plane semantics.
- Goal review planning-issue creation and request-confirmation wake behavior remain covered by their existing focused route tests instead of being duplicated here.
- Human reviewer approval flows beyond accepted plan confirmation are intentionally validated in their dedicated interaction and execution-policy suites.
