# Execution plan — pluggable-tax-providers

**Date:** 2026-09-19
**Branch:** feat/pluggable-tax-providers
**Base:** develop
**Source spec:** .ai/specs/2026-09-19-pluggable-tax-providers.md
**Spec PR:** #3 (design only; this run ships the implementation on its own PR)
**Engine:** om-auto-create-pr-loop (steps: 36, --loop: no — routed by the step threshold)
**Scope amendment (2026-09-19, owner):** MVP scope is Phases 1, 2, 3, 4 and 6 in that order. Phase 5 (commit/adjust/void lifecycle) is deferred by the owner and is NOT implemented in this run — Steps 5.1 to 5.5 carry `Status: deferred` and are skipped by the resume engine. The optional `commit`, `adjust`, `void` methods and the `capabilities` block stay in the `TaxProvider` type (they landed in Step 1.1) so a package written against this contract needs no change when Phase 5 ships. Implementable Steps in this run: 31.

## Tasks

> Authoritative status table. `Status` is one of `todo`, `done` or `deferred`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is `todo` is the resume point for `om-auto-continue-pr-loop`; a `deferred` row is skipped and never implemented. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Tax provider contract types | inline | done | 39c60ccc2 |
| 1 | 1.2 | Tax provider registry | inline | done | ed37ac8a9 |
| 1 | 1.3 | TaxInfo and result schemas | inline | done | d29e41f46 |
| 1 | 1.4 | Tax document context assembly | inline | done | — |
| 1 | 1.5 | Built in table-rates and fixed-rate providers | inline | done | — |
| 1 | 1.6 | Tax stage in the provider totals calculator | inline | done | — |
| 1 | 1.7 | Wire the tax context into every recalculation site | inline | done | — |
| 1 | 1.8 | Tax events and totals payload | inline | done | — |
| 2 | 2.1 | Tax columns on the four document tables | inline | done | — |
| 2 | 2.2 | Persist the tax result on quotes and orders | inline | done | — |
| 2 | 2.3 | Tax columns through command snapshots and undo | inline | done | — |
| 2 | 2.4 | Invoice and credit memo inheritance | inline | done | — |
| 2 | 2.5 | Expose the tax fields on the document APIs | inline | done | — |
| 2 | 2.6 | Recalculate tax command and route | inline | done | — |
| 2 | 2.7 | Document detail: status badge, breakdown, banner | inline | done | — |
| 2 | 2.8 | Order lifecycle tax block and acceptance test 1 | inline | done | — |
| 3 | 3.1 | SalesSettings tax provider columns | inline | done | — |
| 3 | 3.2 | Tax provider settings command and cache | inline | done | — |
| 3 | 3.3 | Tax provider list and settings routes | inline | done | — |
| 3 | 3.4 | Sales configuration tax provider section | inline | done | — |
| 3 | 3.5 | Provider selection, integration state and credentials | inline | done | — |
| 3 | 3.6 | Failure event, error reporting and failure record | inline | done | — |
| 3 | 3.7 | Acceptance tests 2 to 5 | inline | done | — |
| 4 | 4.1 | Customer tax exemption columns | inline | done | — |
| 4 | 4.2 | Customer exemption validators, commands and forms | inline | done | — |
| 4 | 4.3 | Exemption facts into the customer snapshot and the contract | inline | done | — |
| 4 | 4.4 | Customer exemption tests | inline | done | — |
| 5 | 5.1 | Tax transaction lifecycle events | inline | deferred | deferred by the owner |
| 5 | 5.2 | Emit lifecycle requests from document transitions | inline | deferred | deferred by the owner |
| 5 | 5.3 | Lifecycle subscriber and record command | inline | deferred | deferred by the owner |
| 5 | 5.4 | Transaction state on the document detail page | inline | deferred | deferred by the owner |
| 5 | 5.5 | Lifecycle tests | inline | deferred | deferred by the owner |
| 6 | 6.1 | User guide and pricing override docs | inline | done | — |
| 6 | 6.2 | Provider docs and the package building guide | inline | done | — |
| 6 | 6.3 | Sales module framework docs | inline | done | — |
| 6 | 6.4 | Backward compatibility and upgrade notes | inline | done | — |

## Goal

Make tax calculation a first class provider slot on sales documents, with a built in default that reproduces today's table rate math to the cent, per organization selection, persisted provenance, and a lifecycle an external package (the first one being an Avalara AvaTax official module) can use without touching core.

## Scope

- `packages/core/src/modules/sales/` — provider registry and contract, the tax stage in the totals hook, context assembly, document entities and migrations, commands and undo, API routes, settings, detail page, i18n, subscribers, tests.
- `packages/core/src/modules/customers/` — three additive tax exemption columns and their form/validator/command surface (Phase 4).
- `packages/shared/src/modules/integrations/types.ts` — two additive union members (`tax_providers` hub, `tax` category).
- `apps/docs/` plus `BACKWARD_COMPATIBILITY.md` and `UPGRADE_NOTES.md` (Phase 6).

## Non-goals

- No vendor code and no vendor network call in core. The Avalara package is a separate repository/package built against this contract.
- No change to `TaxCalculationService` or the `taxCalculationService` DI token — the unit amount seam stays exactly as it is.
- No backfill of the new columns and no change to any amount for a tenant that never selects a provider.
- No per line ship to addresses (reserved; they travel in `metadata` until a core feature needs them).
- Not touching `packages/enterprise/`.

## Execution notes

Every Step is `inline`. The phases are tightly coupled: Phase 2 persists the exact shape Phase 1 fixes, Phase 3 feeds the context Phase 1 consumes, and Phase 5 replays the request Phase 1 assembles. Splitting them across fresh executor sessions would make each one re-derive the same contract and risk divergent shapes, so the main session carries the whole run.

## Risks

- **A slow provider slows every write.** The provider runs on all 18 recalculation sites. Mitigated by the bounded timeout, the abort signal, the fallback path, and by running before `withAtomicFlush` so no Postgres transaction is held during network I/O.
- **The ⚠ open question in the spec (Q7).** `tax_strategy_key` and `tax_info` are caller writable today and this change gives them core owned semantics. The PR stays a draft until a human confirms or picks the alternative (new columns), which is a contained change: the column names move, the rest of the design does not.
- **Migrations on the shared database.** This worktree is attached to the shared instance database, so `yarn db:migrate` is never run here; the PR carries migration files and snapshots only.
- **Golden equality of the default provider.** The only guarantee that existing tenants do not move by a cent is that `table-rates` is an identity over the engine's own line math; its unit test reuses the engine's own fixtures so any drift breaks it.

## External references

None fetched. Market references (Shopify, Medusa, Saleor, commercetools) were studied at spec time and are recorded in the spec's Market Reference table.
