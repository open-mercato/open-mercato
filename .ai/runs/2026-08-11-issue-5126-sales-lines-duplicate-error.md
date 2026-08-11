# Issue #5126 — sales document form renders the `lines` validation error twice

**Skill chain:** `om-auto-fix-issue` (bug route) → `om-verify-in-repo` → `om-root-cause` → `om-fix` → `om-open-pr` → `om-auto-review-pr`
**Issue:** https://github.com/open-mercato/open-mercato/issues/5126
**Branch:** `fix/issue-5126-sales-lines-duplicate-error` (off `develop` @ `af45bc96e`)

## 🎯 Goal

Make the "Add at least one line item before creating the order." validation message render exactly once when a
sales **order** is submitted with no line items.

## 🔍 Root cause

Nothing defines who owns validation-message rendering for a `type: 'custom'` `CrudForm` field, so two owners
render the same string:

- `packages/ui/src/backend/CrudForm.tsx:4595` — the field wrapper unconditionally renders `error` for every field.
- `packages/core/src/modules/sales/components/documents/SalesOrderDraftLines.tsx:164` — the custom component
  renders the `error` prop it was handed by `SalesDocumentForm.tsx:1320`.

The error is set on a normal user path: `SalesDocumentForm.tsx:1431` throws
`createCrudFormError(message, { lines: message })` when an order has zero lines.

## 📋 Decision — why not the fix the issue proposes

The issue proposes `rendersOwnError: true` on the `lines` field. That flag is introduced by **PR #5063, which is
still open**; `grep -r rendersOwnError` finds nothing on `develop`. Re-implementing the flag here would duplicate
and conflict with another author's change inside `packages/ui/src/backend/CrudForm.tsx`, and `packages/ui/AGENTS.md`
requires asking before changing `CrudForm` contracts.

**Chosen instead:** make this site follow `CrudForm`'s *current default* ownership — the wrapper renders the
message, the component stops rendering its own copy. Self-contained inside `packages/core/src/modules/sales/`,
no `packages/ui` change, and still correct after #5063 merges (an absent `rendersOwnError` keeps the wrapper path).

**Trade-off, recorded deliberately:** the message moves from above the line-items table to below the field wrapper
and loses its `role="alert"`, because `CrudForm`'s wrapper error node carries no ARIA wiring. That gap is
framework-wide (it affects every field, not just this one) and belongs to the #5048 / #5063 thread.

## Progress

- [x] Triage gate (`om-verify-in-repo`) — defect confirmed on `develop`, no PR or commit addresses it
- [x] Root cause located and fix approach decided
- [x] Claim issue (assignee + `in-progress` + claim comment explaining the deviation)
- [x] Remove the component-owned error node from `SalesOrderDraftLines`
- [x] Stop forwarding `error` into the component from `SalesDocumentForm`
- [x] Regression coverage in `salesDocumentFormHoistedRenderers.test.tsx` (verified red before the fix, green after)
- [x] Validation gate
- [x] Open PR — #5188
- [x] Review loop (`om-auto-review-pr --autofix`) — one minor finding fixed in-run (the structural guard was
      narrowed to the props contract); the ARIA trade-off is accepted with a written waiver. GitHub blocks an
      author from approving their own PR, so the report is a comment and the PR still needs a human approval.
- [x] UI verification (`om-auto-qa-pr`) — PASS on a clean ephemeral environment: after submitting an order with
      no lines the message renders in exactly one node (`div.text-xs.text-status-error-text`, the `CrudForm`
      wrapper); the removed `p.text-sm.text-destructive[role=alert]` is absent. Screenshots and DOM measurements
      posted on the PR.
- [ ] Human approval + `qa-approved` (maintainer) — this run deliberately does not add either

## 🧪 Tests

`packages/core/src/modules/sales/components/__tests__/salesDocumentFormHoistedRenderers.test.tsx` gains a
`SalesDocumentForm lines error ownership (#5126)` block:

1. **Behavioral** — the mocked `CrudForm` now mirrors the real field wrapper (renders the custom component *and*
   its own error node for the same field error) and feeds a sentinel error into the `lines` field; the test
   asserts the sentinel appears exactly once. On the pre-fix sources it appears twice.
2. **Structural** — pins that `SalesOrderDraftLines.tsx` carries no `{error ? …}` render of its own, so the
   duplicate cannot be reintroduced silently.

Both were confirmed to fail on the pre-fix sources and pass after the fix.
