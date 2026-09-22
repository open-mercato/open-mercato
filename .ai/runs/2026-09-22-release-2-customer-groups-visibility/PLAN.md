# Plan — Release 2 (part 1 of 2): customer_groups Phases 1–2 + buyer-scoped catalog visibility Phase 1

**Slug:** release-2-customer-groups-visibility
**Branch:** feat/release-2-customer-groups-visibility
**Base branch:** develop
**Source specs:**
- `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` — §14 Phase 1 + Phase 2 only
- `.ai/specs/2026-08-21-buyer-scoped-catalog-visibility.md` — §12 Phase 1 only

> **This PR is deliberately STACKED and BLOCKED.** It is built on top of unmerged PR #6268
> (`feat(catalog): pricing engine admin UI + resolver hardening (phases 1-2)`, branch
> `cez/d58af91f`) and MUST NOT merge before #6268 merges to `develop`. See Risks below and
> the PR body's `## Blocked on` section.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Stack branch on PR #6268 (chore merge commit) | inline | done | 29be10b03 |
| 0 | 0.2 | Run-folder commit (this plan) | inline | done | bf3893c22 |
| 1 | 1.1 | Scaffold `customer_groups` module skeleton | inline | done | 8859f3045 |
| 1 | 1.2 | `CustomerGroup` + `CustomerGroupMembership` entities and validators | dispatch:standard | done | 16e2a8d58 |
| 1 | 1.3 | Generate + review Phase 1 migration | inline | done | d8e756b39 |
| 1 | 1.4 | `customerGroupsService.resolveGroups()` + unit tests | dispatch:capable | done | 3effc1830 |
| 1 | 1.5 | API routes: `/api/customer-groups` CRUD | dispatch:standard | done | 70cd10f06 |
| 1 | 1.5-fix | Clear-and-set default-group semantics (gap found during Step 1.8) | inline | done | 99ac74b80 |
| 1 | 1.3-fix | Make (tenant_id, priority) uniqueness soft-delete-aware (gap found during Step 1.6) | inline | done | 19de77865 |
| 1 | 1.6 | API routes: `/api/customer-groups/memberships` CRUD + reorder command/route | group:A | done | dda675fb4 |
| 1 | 1.7 | Admin UI: group list (drag-reorder, orphan banner mount) | group:A | done | 3dce7cceb |
| 1 | 1.8 | Admin UI: group create/edit page (Phase 1 fields) | dispatch:standard | done | 31c78ed51 |
| 1 | 1.9 | Membership assignment UI on customer detail page | dispatch:capable | done | 578d0d565 |
| 1 | 1.10 | Reconciliation CLI + `GET /api/customer-groups/reconcile` + orphan banner data wiring | group:B | done | b493cc279 |
| 1 | 1.11 | Group picker widget → `crud-form:catalog.catalog_product_price:fields` + `crud-form:sales.sales_tax_rate:fields` | group:B | done | 87691ea81 |
| 1 | 1.12 | i18n keys — Phase 1 surfaces (en/de/es/ko/pl) | dispatch:cheap | done | 09c22259b |
| 1 | 1.13 | Integration tests: Phase 1 API routes + behavioral cases | dispatch:capable | done | 519730eee |
| 1 | 1.14 | Integration tests: Phase 1 UI paths | dispatch:capable | todo | — |
| 2 | 2.1 | `CustomerGroupTerms` entity + validators | dispatch:standard | done | 8a3f3168c |
| 2 | 2.2 | Generate + review Phase 2 migration | inline | done | 59223f63a |
| 2 | 2.3 | `resolveTerms()` per-field inheritance + `sourceGroupId` + unit tests | dispatch:capable | done | cc6f6d704 |
| 2 | 2.4 | API routes: `GET/PUT /api/customer-groups/:id/terms` | dispatch:standard | done | 1ba6d6d03 |
| 2 | 2.5 | Admin UI: terms section on group edit page | dispatch:capable | done | 5d37eb8ef |
| 2 | 2.6 | Explain-terms panel on customer detail page | dispatch:capable | todo | — |
| 2 | 2.7 | i18n keys — Phase 2 surfaces | dispatch:cheap | todo | — |
| 2 | 2.8 | Integration tests: Phase 2 API routes + behavioral cases (incl. deprecated single-value equivalence) | dispatch:capable | todo | — |
| 2 | 2.9 | Integration tests: Phase 2 UI paths | dispatch:capable | todo | — |
| 3 | 3.1 | `packages/shared/src/lib/catalog-visibility/` types + pure functions + AGENTS.md library row | dispatch:capable | todo | — |
| 3 | 3.2 | `customerGroupsService.resolveAssortmentScope()` + remove `ResolvedTerms.assortmentScope` | dispatch:standard | todo | — |
| 3 | 3.3 | Unit tests: §11 pure-function matrix (incl. R2 disjoint-dimension fixture + distributive law) + `resolveAssortmentScope` multi-group tests | dispatch:capable | todo | — |

## Goal

Ship `customer_groups` Phase 1 (groups + memberships, admin CRUD, reconciliation) and Phase 2
(commercial terms, per-field inheritance, explain panel), plus the `catalog-visibility` Phase 1
pure-function library and `resolveAssortmentScope()`, as a stacked/blocked PR on top of unmerged
PR #6268.

## Scope

Exactly customer_groups spec §14 Phase 1 + Phase 2, and catalog-visibility spec §12 Phase 1. Full
detail captured by research agents before planning (entity shapes, function signatures, gate
criteria, UI requirements, integration-test lists) — implementers should treat the Step bullets
below plus the two source specs as authoritative; do not re-derive from scratch.

## Non-goals (do not implement)

- customer_groups Phases 3–5: credit accounts/ledger, purchase approvals, per-customer assortment
  overrides (`CustomerAssortmentOverride`), rule-driven membership, per-org private groups.
- catalog-visibility Phases 2–4: `ecommerce` `BuyerContext.assortmentScope` composition,
  `require_authentication`, `cart` write-path enforcement, SQL-side `buildStorefrontProductScope`.
- Any edit to files owned by PR #6268: `catalog/lib/pricing.ts`'s `PricingContext` type block and
  `matchesContext`; `catalog/components/prices/*`; `catalog/backend/catalog/prices/**`.
- The FK constraint on `customer_group_id` columns (explicitly deferred to a future spec, §8.3).
- A `tax_display_mode` column on `CustomerGroupTerms` (withdrawn by spec amendment §6.1a — gross/net
  is derived from `CatalogPriceKind.displayMode` downstream, in `ecommerce`, out of scope here).

## Risks

- **Stacked on unmerged PR #6268.** Branch `feat/release-2-customer-groups-visibility` starts with
  a merge commit onto `cez/d58af91f` @ `c2c6c420b9cecbe1618b9efdc957d14c112e4d99`. If #6268 is
  updated before this PR merges, this branch needs a follow-up merge from `develop` once #6268
  lands there (the stacking merge should then be a no-op). This PR carries the `blocked` pipeline
  label instead of `review` for its whole lifetime until #6268 merges.
- **Group-priority tie-break in `catalog/lib/pricing.ts` is explicitly NOT implemented.** The
  customer_groups spec §7.1 describes a second-order tie-break ("the row whose group carries the
  highest `CustomerGroup.priority` wins among equally-scored price rows") that would require
  editing `scorePrice`/`selectBestPrice` inside `catalog/lib/pricing.ts` — a file this PR is
  constrained never to edit (owned by #6268), and `catalog/AGENTS.md` § Ask First independently
  gates "changing resolver priority semantics" behind explicit confirmation. The spec text itself
  acknowledges this ("per `catalog/AGENTS.md` § Ask First, changing resolver priority semantics is
  explicitly out of scope for both specs"). This PR ships `resolveGroups()` returning
  priority-ordered group ids (the input `catalog`/`sales` already consume unchanged via
  `PricingContext.customerGroupIds`) and integration tests proving basic membership-based
  resolution works; the tie-break itself is logged as a blocker/follow-up, not implemented. See
  `NOTIFY.md`.
- New module (`customer_groups`), two new DB entities in Phase 1 + one in Phase 2 with migrations,
  cross-module widget injection into two other modules' CrudForms — overall `risk-high`.

## External References

None (`--skill-url` not used).
