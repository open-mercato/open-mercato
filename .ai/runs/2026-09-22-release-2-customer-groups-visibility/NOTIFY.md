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
