# Issue #5126 — sales document form renders the `lines` validation error twice

**Skill chain:** `om-auto-fix-issue` (bug route) → `om-verify-in-repo` → `om-root-cause` → `om-fix` → `om-open-pr` → `om-auto-review-pr`
**Issue:** https://github.com/open-mercato/open-mercato/issues/5126
**Branch:** `fix/issue-5126-sales-lines-duplicate-error` (off `develop` @ `af45bc96e`)

## 🎯 Goal

Make the "Add at least one line item before creating the order." validation message render exactly once when a
sales **order** is submitted with no line items.

## 🔍 Root cause

Nothing defined who owns validation-message rendering for a `type: 'custom'` `CrudForm` field, so two owners
rendered the same string (line references are to the tree this branch forked from, before #5063 merged):

- `packages/ui/src/backend/CrudForm.tsx:4595` — the field wrapper unconditionally renders `error` for every field.
- `packages/core/src/modules/sales/components/documents/SalesOrderDraftLines.tsx:164` — the custom component
  renders the `error` prop it was handed by `SalesDocumentForm.tsx:1320`.

The error is set on a normal user path: `SalesDocumentForm.tsx:1431` throws
`createCrudFormError(message, { lines: message })` when an order has zero lines.

## 📋 Decision — component-owned rendering via `rendersOwnError`

The issue proposes `rendersOwnError: true` on the `lines` field, and that is what this branch now does: the
component keeps its own `role="alert"` node and the field declaration opts out of `CrudForm`'s wrapper copy.

**Superseded first attempt (2026-08-11).** The branch originally went the other way — delete the component's node
and let the wrapper be the sole renderer — on the premise that `rendersOwnError` did not exist yet because
**PR #5063 was still open**. That premise expired: **#5063 merged to `develop` on 2026-08-11 at 14:32Z**
(commit `a8d208fcd`), a few hours after this branch's last commit. On today's `develop` the flag is declared at
`packages/ui/src/backend/CrudForm.tsx:288`, honored at `:4726`
(`error && !(field.type === 'custom' && field.rendersOwnError)`), and already used by three call sites
(`customers/components/formConfig.tsx:425` and `:1266`, plus the propagation in
`ui/backend/utils/customFieldForms.ts:139`). @adeptofvoltron flagged the stale premise in review
(2026-08-14) and overruled the accessibility waiver it was resting on.

**Why the flag is the better direction here.** Wrapper ownership fixes the duplicate but pays for it with a
regression this diff would have introduced: `CrudForm`'s wrapper error node is a bare
`<div className="text-xs text-status-error-text">` with no `role`, `aria-live`, or `aria-describedby`, so a
screen-reader user submitting an order with zero lines would get no announcement at all — a silent, visual-only
failure. That ARIA gap is framework-wide and pre-existing for every other field; this field *had* the
announcement, and trading it away to remove a visual duplicate is the wrong direction. Component ownership
removes the duplicate, keeps the announcement, and keeps the message directly above the line-items table where
the user is acting. The merged spec `.ai/specs/2026-08-06-crudform-custom-field-error-ownership.md` allows either
layer to own the node — the tie is broken by the accessible one.

The restored node uses the `text-status-error-text` DS token rather than the original `text-destructive`, so the
accessibility affordance comes back without giving up the design-system improvement the first attempt made.

## Progress

- [x] Triage gate (`om-verify-in-repo`) — defect confirmed on `develop`, no PR or commit addresses it
- [x] Root cause located and fix approach decided
- [x] Claim issue (assignee + `in-progress` + claim comment explaining the deviation)
- [x] First attempt (superseded): wrapper-owned rendering — component node removed, `error` no longer forwarded
- [x] Regression coverage in `salesDocumentFormHoistedRenderers.test.tsx` (verified red before the fix, green after)
- [x] Validation gate
- [x] Open PR — #5188
- [x] Review pass 1 (`om-auto-review-pr --autofix`, self) — one minor finding fixed in-run (the structural guard
      was narrowed to the props contract); the ARIA trade-off was accepted with a written waiver
- [x] UI verification pass 1 (`om-auto-qa-pr`) — PASS for the wrapper-owned approach on a clean ephemeral
      environment; superseded by the approach change below
- [x] Review pass 2 (@adeptofvoltron, 2026-08-14) — CHANGES REQUESTED: one major (stale `rendersOwnError`
      premise + the accessibility regression it justified), two minors, two nits
- [x] `om-auto-fix-pr` pass (2026-08-22): merged the latest `develop` (455 commits, clean), then switched the
      approach to component-owned rendering — `rendersOwnError: true` on the `lines` field, `error` forwarded
      again, `role="alert"` node restored on the `text-status-error-text` token
- [x] Rewrote the `#5126` test block so it cannot pass vacuously: the mocked `CrudForm` now mirrors the real
      wrapper's `rendersOwnError` condition, the count assertion is gated on the component having actually
      rendered, and the brittle source-regex guard is replaced by an assertion on the captured field declaration
- [x] Corrected the stale rationale in this plan and in the PR body
- [ ] UI verification pass 2 (`om-auto-qa-pr`) — re-run required because the rendering owner changed
- [ ] Human approval + `qa-approved` (maintainer) — this run deliberately does not add either

## 🧪 Tests

`packages/core/src/modules/sales/components/__tests__/salesDocumentFormHoistedRenderers.test.tsx` gains a
`SalesDocumentForm lines error ownership (#5126)` block. The mocked `CrudForm` mirrors the real field wrapper
including its `rendersOwnError` condition — it renders the custom component, then its own error node for the
same field error *unless* the field opted out — and feeds a sentinel error into the `lines` field:

1. **Count + owner** — the sentinel appears exactly once and the surviving node carries `role="alert"`, proving
   the component is the single renderer. The assertion is gated on `data-table` being present, so it cannot pass
   vacuously when the component did not render at all.
2. **Position** — the message precedes the line-items table in document order, pinning the placement the
   accessibility argument rests on.
3. **Contract** — the `lines` field declaration captured from the real form carries `type: 'custom'` and
   `rendersOwnError: true`. This replaces the previous source-text regex guard, whose `[^}]*` match would have
   silently truncated (and stopped guarding) the first time the props type grew a braced member.

Verified in both failure directions: dropping `rendersOwnError` while keeping the component node fails 3 tests
(the duplicate returns), and removing the component node while keeping the flag fails 2 (the message disappears
entirely). The previous test block was green in both of those states.
