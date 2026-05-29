# Optimistic locking by default on every CrudForm (universal client coverage)

**Status:** in progress
**Depends on:** #2055 (OSS optimistic locking — server default-ON, conflict bar, command-level seam). This branch is stacked on `feat/oss-optimistic-locking`.
**Tracking issue:** (filed alongside this spec)

## TLDR

Server-side optimistic locking is already universal in #2055 (default-ON for every `makeCrudRoute` entity). Client-side it is **opt-in per form**: a `CrudForm` only sends the `x-om-ext-optimistic-lock-expected-updated-at` header when the caller passes `optimisticLockUpdatedAt={record.updatedAt}` (28 of ~96 CrudForms today). This spec makes the lock the **default for every edit-mode CrudForm** by having CrudForm **auto-derive** the version from `initialValues.updatedAt` when the prop is absent, with an explicit opt-out — then sweeps each module to guarantee `initialValues` carries `updatedAt`.

## Problem

Module authors must remember to pass `optimisticLockUpdatedAt` on every edit form. Forms that forget silently allow concurrent overwrites even though the server would 409 if the header were sent. New forms inherit the gap.

## Proposed solution

1. **CrudForm auto-derive (keystone).** In update/edit mode only, when `optimisticLockUpdatedAt` is `undefined`, fall back to `initialValues?.updatedAt ?? initialValues?.updated_at ?? null` when building the header on submit AND delete. Explicit prop (including `null`) wins. Create mode never attaches.
2. **Opt-out.** New `disableOptimisticLock?: boolean` (default `false`) — never attach the header when `true` (for forms whose locking is owned elsewhere, e.g. sales sub-resource document aggregates, or entities without `updatedAt`).
3. **Per-module sweep.** Guarantee every edit form's `initialValues` includes `updatedAt`; simplify the few forms that wire the header manually to rely on auto-derive; close the known gaps (workflows definition page: add `updatedAt`, guard DELETE).

Backward compatible: forms already passing the prop are unaffected; forms with manual `onSubmit` wiring keep working (auto-derive only fills the gap when no header would otherwise be sent — guard against double-attach).

## Rollout plan (phased; Playwright check per updated place)

### Phase 1 — CrudForm auto-derive + opt-out + unit tests
- `packages/ui/src/backend/CrudForm.tsx`: thread the fallback at both header-build sites; add `disableOptimisticLock`.
- Unit tests: edit+no-prop+updatedAt→header; snake_case fallback; no updatedAt→no header; explicit `null`→no header; explicit value wins; `disableOptimisticLock`→never; create→never.

### Phase 2 — Verification-only sweep (forms already passing the prop)
Regression Playwright per file (edit → 2-tab stale save → 409 + bar). Files (passesProp=yes): sales settings (`ChannelOfferForm`, `PaymentMethodsSettings`, `ShippingMethodsSettings`, `TaxRatesSettings`), customers (`companies-v2`, `people-v2`, `formConfig`), catalog `categories/[id]/edit`, staff (`LeaveRequestForm`, `TeamForm`, `TeamMemberForm`, `TeamRoleForm`, `JobHistorySection`), auth (`roles/[id]/edit`, `users/[id]/edit`), resources/planner (`ResourceCrudForm`, `ResourceTypeCrudForm`, `AvailabilityRuleSetForm`, `AvailabilitySchedule`), misc (`business_rules` rules/sets, `currencies` currencies/exchange-rates, `customer_accounts` roles, `directory` organizations/tenants, `entities` user records, `feature_toggles` global).

### Phase 3 — Catalog: drop manual onSubmit wiring in favor of auto-derive
- `catalog/backend/catalog/products/[id]/page.tsx` and `.../variants/[variantId]/page.tsx`: `initialValues.updatedAt` already populated; remove manual `buildOptimisticLockHeader` in onSubmit (let CrudForm derive), keep `handleVariantDeleteError`/`surfaceRecordConflict` for delete UX; avoid double-header. Playwright: stale edit → 409; stale variant delete → conflict bar.

### Phase 4 — workflows definition page (close the gap)
- `workflows/backend/definitions/[id]/page.tsx`: add `updatedAt` to `parseWorkflowToFormValues` so `initialValues.updatedAt` is populated; let auto-derive cover PUT; **guard DELETE** through the mutation guard. Playwright: stale edit → 409; stale delete → 409.

### Phase 5 — Non-CrudForm DataTable/dialog mutations (confirm, no change expected)
- `catalog/components/products/ProductsDataTable.tsx`, `catalog/components/PriceKindSettings.tsx`: already attach the header; add a stale-delete Playwright check each.

### EXCLUDE (do not add per-form locking)
- Create-only: `sales/components/SalesDocumentForm.tsx`.
- Sales sub-resource aggregates (lines/adjustments/payments/shipments/returns/quote-convert): locked at the command layer against the parent document; if a child uses CrudForm, set `disableOptimisticLock`.
- Legacy non-v2 customers list pages (DataTable, no edit form).

### Final — docs + gate
- `packages/ui/AGENTS.md` CrudForm Guidelines: document auto-derive default + `disableOptimisticLock` + the "edit-mode `initialValues` MUST include `updatedAt`" rule.
- Advisory CI check flagging edit-mode CrudForm whose initialValues type lacks `updatedAt`.
- Gate: `yarn generate && build:packages && typecheck && lint && test && test:integration` (focused).

## Backward compatibility
Additive: explicit prop wins, create-mode never attaches, snake/camel fallback, opt-out. Forms relying on manual wiring keep working (no double-attach). The only behavior change: edit forms that previously didn't lock now 409 on concurrent edits — the desired safety behavior, consistent with #2055's Phase-14 "default ON" decision.

## Changelog
### 2026-05-29
- Spec created.
- Phase 1 (CrudForm auto-derive + `disableOptimisticLock` opt-out + 7 tests) — done (`eb850e6e8`).
- Phase 3 (catalog products/variants: removed redundant manual header wrap → single source via auto-derive; kept variant delete-conflict UX) — done (`35dcebf65`).
- Phase 4 (workflows: `id`+`updatedAt` into definition initialValues; guarded the definitions list-page DELETE with the lock header + conflict bar; server-side DELETE already guarded) — done (`35dcebf65`).
- Docs: `packages/ui/AGENTS.md` CrudForm Guidelines updated with the auto-derive default + opt-out + no-double-wrap rule.
- Remaining: Phase 2 (verification-only regression sweep of the ~28 forms already passing the prop) + Phase 5 (confirm non-CrudForm dialog mutations) + final advisory CI check — each with a live Playwright stale-edit check per place (run via the follow-up loop against a branch dev server).
