# Notify — 2026-09-22-release-2-customer-groups-visibility

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-22T09:35:00Z — run started
- Brief: implement customer_groups Phases 1-2 + buyer-scoped catalog visibility Phase 1, stacked on unmerged PR #6268.
- External skill URLs: none.

## 2026-09-22T09:41:00Z — Step 0.1 complete
- Merged PR #6268 (`cez/d58af91f` @ c2c6c420b9c) onto the feature branch as the required first commit (29be10b03). Verified `PricingContext.customerGroupIds`, `currencyCode`, `buildPriceRowFilter`, and the `@deprecated` marker are present.

## 2026-09-22T09:50:00Z — blocker: group-priority tie-break in pricing.ts deliberately not implemented
- The customer_groups spec (§7.1) describes a second-order tie-break in `catalog`'s price resolver: "when two or more equally-scored rows match by way of different groups the buyer belongs to, the row whose group carries the highest `CustomerGroup.priority` wins." Implementing it requires editing `scorePrice`/`selectBestPrice` inside `packages/core/src/modules/catalog/lib/pricing.ts`.
- This PR's hard constraints forbid editing files owned by unmerged PR #6268, including `pricing.ts`'s `matchesContext`/type block. `catalog/AGENTS.md` § Ask First independently requires confirmation before "changing resolver priority semantics." The spec text itself acknowledges this exact boundary.
- Decision: do NOT implement the tie-break in this PR. `resolveGroups()` (Step 1.4) returns group ids already ordered by `CustomerGroup.priority` descending, which `catalog`/`sales` already consume unchanged via `PricingContext.customerGroupIds` (#6268's set-membership matching). Integration tests (Steps 1.13, 2.8) prove basic membership-based price/tax resolution works without the second-order tie-break. Logged as a Risk in `PLAN.md`; flagged in the PR body for follow-up once #6268 merges and the tie-break can be scoped as its own small change with explicit sign-off.

## 2026-09-22T09:52:00Z — PLAN.md drafted
- 26-Step plan across 3 phases (groups/membership, commercial terms, catalog-visibility) drafted from three research passes (customer_groups spec extraction, catalog-visibility spec extraction, reference-pattern survey). Committing run folder next.

## 2026-09-22T10:35:00Z — checkpoint 1 (Steps 0.1..1.8)
- Landed: module scaffold, Phase 1 entities + migration, resolveGroups(), full CRUD (groups + memberships), priority reorder, admin list (drag-reorder) + create/edit pages.
- All checks green: typecheck, unit tests (15), codegen, migration-drift (`no changes`), package build, strict DS lint. Full detail: `checkpoint-1-checks.md`.
- Two real gaps found and fixed as appended Steps: 1.5-fix (default-group clear-and-set) and 1.3-fix (priority unique index made soft-delete-aware — was a plain constraint, would have permanently reserved a deleted group's priority value).
- UI/browser verification deliberately skipped this checkpoint: Phase 1's UI surface isn't feature-complete yet (membership assignment, orphan banner, group picker widget, i18n all still todo). Deferred to Step 1.14 / final gate.
- Subagent delegations this window: entities+validators (1.2), resolveGroups+tests (1.4), CRUD routes (1.5, simplified post-hoc to drop an unneeded [id] route), create/edit page (1.8), membership CRUD+reorder+list UI (1.6+1.7 grouped).

## 2026-09-22T12:51:00Z — decision: sales tax-rate group picker ships inert
- Steps 1.10/1.11/1.9 landed (reconciliation CLI+banner, group-picker widget, membership tab on customer detail — the latter via the proven `detail:customers.person/company:tabs` spot, no customers module edit needed).
- Gap found and confirmed independently by two agents: `sales/components/TaxRatesSettings.tsx` renders its `CrudForm` without an `entityId`, so `crud-form:sales.sales_tax_rate:fields` never resolves — the injected group picker is correctly wired but inert on the sales side. The catalog side works (`catalog/backend/catalog/prices/[id]/edit/page.tsx` already passes `entityId={E.catalog.catalog_product_price}`).
- Decision: do NOT edit `sales/` to fix this — it's outside the hard catalog/sales off-limits constraint for this PR. Flagged as a follow-up needing an explicit ask; noted in the Step 1.11 commit message and PR body.
- Also fixed a real bug found during review of the adopt logic: priority assignment floored at 0 per step, which would assign duplicate priorities (crashing the batch) once a tenant's minimum priority was within ~10 of zero. Fixed by allowing negative priorities for these always-inactive placeholder rows; added a regression test.
- Also reconciled a genuine concurrent-agent file collision on `widgets/injection-table.ts` (Step 1.9's tab mapping and Step 1.11's field-widget mapping both targeted the same new file) — merged manually, verified via `yarn generate` that both widgets register correctly.

## 2026-09-22T13:35:00Z — resumed after provider rate-limit interruption
- Session hit a rate limit mid-dispatch of Step 2.6; resumed after reset (2:30pm Europe/Warsaw).
- Recovered Step 1.13's completed work from a "cezar autosave (run finalize)" commit — reviewed for quality (9 Playwright integration tests + fixtures, high quality, real second-tenant fixtures, TC-CGRP-007 correctly implements the literal Phase 1 acceptance gate), amended with a proper message, pushed as 51dff0108.
- Step 2.6's first dispatch attempt failed instantly on the same rate limit before writing anything — clean re-dispatch, no recovery needed.
- Integration tests confirmed syntactically valid and discoverable (playwright --list, 9/9 found) but not executed end-to-end this session — no dev server/DB was stood up. Deferred to the final gate.

## 2026-09-22T14:56:00Z — decision: intersectScopes' exact distributive-law property is provably unsatisfiable in general
- Step 3.1 (catalog-visibility library) landed. During review, verified a significant finding: the spec's own stated requirement for `intersectScopes` — `matchesScope(intersectScopes(channel, group)) === matchesOne(channel) && matchesScope(group)` for "every fixture" — cannot hold exactly in general given the `AssortmentScope` type (categoryIds/tagIds are existentials — "has ANY of these ids"). Proof: for a product satisfying channel's existential via one id and group's existential via a *different*, non-shared id on the *same* dimension (e.g. channel `{tagIds:['channel-only']}`, group `{tagIds:['group-only']}`, product has both tags), there is no single existential set that captures "channel-only OR group-only, both required" without either under- or over-granting.
- This ONLY affects same-dimension, incomparable (neither-subset), both-non-empty combinations. It does NOT affect: the R2 named regression fixture (different dimensions — categoryIds vs tagIds — which composes exactly), the case where one side is unrestricted, or the case where one set is a subset of the other (all proven exact).
- Verified independently (re-derived the same counter-example by hand) before accepting — this is correct, not a shortcut.
- Resolution implemented: set-intersection per dimension when both sides restrict and are incomparable, falling back to `undefined` restriction dropped entirely (branch removed as unsatisfiable) only when the intersection is empty — sound (never over-grants visibility) but not complete (can under-grant in this narrow, documented boundary). This is the safe failure direction for a visibility/security-adjacent gate.
- Tests separate an unconditional soundness property (3000 generated cases) from a full-equality property restricted to the non-conflicting domain (also 3000 cases, confirmed non-vacuous), plus explicit named regression tests for the boundary itself.
- This is worth flagging to a human reviewer / the spec's original author: either the spec's "for every fixture" wording should be narrowed to acknowledge this structural limit, or a future phase may want a richer type (e.g. a list-of-required-ids field, distinct from the existing OR-semantics fields) if exact same-dimension intersection ever becomes a real product requirement.
