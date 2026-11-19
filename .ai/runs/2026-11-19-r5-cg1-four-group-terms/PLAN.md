# Execution plan — r5-cg1-four-group-terms

**Date:** 2026-11-19
**Branch:** feat/r5-cg1-four-group-terms (stacked on #9991 → #9988, fork point `3261760b4d`)
**PR base:** main
**Source spec:** .ai/specs/2026-08-14-customer-groups-and-b2b-terms.md (§5.3, §6, §6.0, §6.1, §7.3, §8.4, §13 "Phase 3 — terms (CG1)", §14 step CG1)
**Reference implementation:** closed PR #8268 at `bdb747c36a`, diff base `b7b5309ccc` (customer_groups is byte-identical between the diff base and this branch's fork point, so reference hunks apply cleanly)
**Mode:** Spec-implementation run

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Four terms columns: entity, validators, migration and snapshot | inline | done | ac296e1682 |
| 1 | 1.2 | resolveTerms resolves the four fields with the base-currency fallback | inline | done | dde00c6a50 |
| 1 | 1.3 | Terms route stores and returns the four fields | inline | done | 0989602ad4 |
| 1 | 1.4 | Explain-terms rows for the four fields and the base-currency sentinel | inline | done | bc56d5d8f9 |
| 2 | 2.1 | Terms form fields with default-group and missing-currency warnings | inline | done | 997441cd0a |
| 2 | 2.2 | UPGRADE_NOTES override note for ResolvedTerms | inline | done | 6f30f3020d |

## Goal

Make `terms_currency_code`, `approval_policy`, `allow_quote_requests` and `requires_po_number` storable on a customer group, editable through the terms route and the terms form, resolved by `resolveTerms` (with the D-R5-37 base-currency fallback), and explained per field by explain-terms.

## Scope

All paths relative to `packages/core/src/modules/customer_groups/`:

- `data/entities.ts` — `CustomerGroupApprovalPolicy`, four `@Property` blocks on `CustomerGroupTerms` (no `Check`/`ManyToOne`/`Unique` import).
- `migrations/` — one migration adding the four nullable columns to `customer_group_terms`, with `down()`; snapshot `customer_group_terms` 16 → 20 columns.
- `data/validators.ts` — `customerGroupApprovalPolicyValues/Schema`, four entries in `customerGroupTermsBaseShape`.
- `services/customerGroupsService.ts` — four `TERMS_FIELD_NAMES`, defaults, `organizationId?`, `applyTermsCurrencyFallback`.
- `di.ts` — `softCradle`, `BaseCurrencyService` type, rewritten `customerGroupsService` registration.
- `api/customer-groups/[id]/terms/route.ts` — `toEntityData`, `applyTermsUpdate`, `serializeTerms`, `termsItemSchema`.
- `api/customer-groups/explain-terms/route.ts` + `widgets/injection/person-groups-explain-terms.tsx` — four rows, sentinel rendering, `organizationId` passed.
- `components/CustomerGroupTermsSection.tsx` + `i18n/{en,de,es,pl,ko}.json` — four form fields and two warnings.
- `UPGRADE_NOTES.md` — override note.
- Tests: `__tests__/resolveTerms.test.ts`, terms `__tests__/route.test.ts`, `api/customer-groups/__tests__/validators.test.ts`, explain-terms and form tests.

## Non-goals

- Credit entities/validators (CG2a), `customerCreditService` registration (CG2b), approval entity/services (CG6).
- Any consumer behaviour (cart approval gate, checkout quote request, PO number). The four fields stay inert until CG6, CA6 and CH6a.
- `ecommerce` `buyerContext.test.ts` mocks — left untouched.
- Stored-threshold behaviour-change UPGRADE note (ships with the step that starts reading thresholds).

## Rules adopted (binding)

- Spec wins over the card / reference where they differ (R4); differences are logged below.
- Port the reference slice, do not redesign.

## Differences from the card / reference (logged per R4)

| # | Card / reference | Spec / this PR | Source |
|---|------------------|----------------|--------|
| 1 | `termsCurrencyCode` validated by `currencyCodeSchema` (any ≤4-char string) | ISO 4217 three uppercase letters `/^[A-Z]{3}$/`; `eur`/`EURO` → 400, `''`/null clears | spec §5.3, §13 CG1, audit row 37 |
| 2 | Reference never touched explain-terms; its comment says explain-terms keeps `termsCurrencyCode` null | Explain-terms gains the four rows, passes the customer's `organizationId`, renders `'base_currency'` as "Organization base currency", not as a group | spec §6.0, §13 CG1, §14 CG1, audit rows 34–35, B3 |
| 3 | No terms-form UI | Terms form gains the four fields (Inherit / explicit) and the default-group and missing-currency warnings, CrudForm + i18n in 5 locales | spec §7.3, D-R5-CG4 |
| 4 | No UPGRADE note | `UPGRADE_NOTES.md` override note (four fields, `organizationId`, sentinel) | spec §8.4, audit B3 |
| 5 | Money as `numeric(16,2)` in the reference credit slice | Not applicable to CG1 — no new money columns; shipped terms money stays `ExactDecimalType` (#7324) | spec C1 |
| 7 | Spec says explain-terms "renders the sentinel as the base currency" without a wire shape | Each explain-terms field gains an additive `source` (`group` \| `tenant_default` \| `base_currency`); `sourceGroupId` stays a uuid or null, so the sentinel never reaches a group-id reader | spec §6.0 |
| 8 | Spec's missing-currency warning is phrased for a null resolved currency | The form cannot resolve the chain, so it warns whenever this group sets a threshold or minimum with no terms currency, and names the D-R5-37 fallback order | spec §7.3, D-R5-4, D-R5-37 |
| 6 | The relanding plan file (§6 R1–R14, card CG1) was not available in the primary checkout | Proceeded from the card text in the brief and the binding spec; user instructed to continue autonomously | NOTIFY 2026-11-19 |

## Audit findings and decisions that concern CG1

- **B3** — `ResolvedTerms` gains four fields; overriders must return them; `'base_currency'` sentinel must be handled by explain-terms → Steps 1.2, 1.4, 2.2.
- **B4** — `ResolveTermsInput.organizationId?` → Step 1.2; explain-terms passes it → Step 1.4.
- **Audit rows 34, 35, 37** — fallback needs `organizationId`; explain rows missing; ISO uppercase validation → Steps 1.1, 1.4.
- **D-R5-CG4** — terms-form fields and both warnings ship in Release 5 → Step 2.1.
- **D-R5-37** (2026-10-26 entry) — base-currency fallback and sentinel → Step 1.2.

## Implementation Plan

### Phase 1 — Data, service and API

- **1.1 Four terms columns: entity, validators, migration and snapshot** — entity properties and type; validators (ISO currency per diff #1); migration `alter table "customer_group_terms" add column …` × 4 with `down()`; snapshot 16 → 20 columns; validator tests (reference three `it` blocks + ISO case).
- **1.2 resolveTerms resolves the four fields with the base-currency fallback** — port reference service hunks + DI registration; `resolveTerms.test.ts` reference cases. Must keep: fallback after per-field loop and on no-groups path, never throws, sets `sources.termsCurrencyCode = 'base_currency'`, skipped without `organizationId` or `baseCurrencyService`; defaults `buyer` / `false` / `false` / `null`.
- **1.3 Terms route stores and returns the four fields** — `toEntityData`, `applyTermsUpdate`, `serializeTerms`, `termsItemSchema`; reference route test.
- **1.4 Explain-terms rows for the four fields and the base-currency sentinel** — route passes the customer's organization id, adds four fields, an additive `source` discriminator; panel renders rows and the sentinel; tests.

### Phase 2 — Admin UI and docs

- **2.1 Terms form fields with default-group and missing-currency warnings** — four CrudForm fields, warnings per §7.3, i18n en/de/es/pl/ko; component test.
- **2.2 UPGRADE_NOTES override note for ResolvedTerms** — per §8.4.

## Risks

- Overriders of `customerGroupsService` must return four new fields (documented, Step 2.2).
- Migration is additive and nullable; no backfill.
- Integration suite may not be runnable locally (DB/dev env); recorded in final gate if skipped.

## External References

- None (`--skill-url` not passed).
