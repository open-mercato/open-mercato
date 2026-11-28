# Deal People link dates

Source doc: .ai/specs/2026-08-27-deal-people-tab-linked-people-parity.md

## Goal

Complete the final delivery for #5732. Keep each surviving person's original link date when the Deal People membership changes, then show that date and enable sorting by recency.

## Scope

PR #5757 delivered the deal version update and PR #5814 delivered the shared People section. This run covers steps 7–8 of the spec and uses the sortable Linked column introduced in #8539. Company-link reconciliation is deferred because the Companies tab does not display link dates.

## Implementation Plan

1. Reconcile deal-person links in place. Validate new people in scope and flush removal or demotion of a displaced primary before promoting its successor. Cover membership, primary changes, and restore paths in the command suite.
2. Enable the shared Linked column and recency sort for deals. Extend the Deal People unit and integration tests to verify ordering and date preservation after unlinking.

## Risks

- The partial unique index on the primary flag is immediate. Verify that both deleting and demoting the old primary precede promotion within the transaction.
- Existing dates are retained as stored. Prior writes may already have reset those timestamps.

## Progress

PR: #10548

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Durable deal-person links

- [x] 1.1 Preserve surviving link rows and reconcile the primary person — cc56ffab43

### Phase 2: Linked date and recency sort

- [x] 2.1 Enable the shared Linked column and verify recency after unlinking — 86db0e00f7
