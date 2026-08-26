# NBP average-rate contract

**Goal:** Add the opt-in `nbp_average` currency-rate provider, explicit provider/type selection, provenance storage, REST/UI support, tests, and upgrade documentation.

**Source spec:** `/Users/kamil-nowak/Documents/work/development/tracecore/open-mercato/.ai/specs/2026-08-25-nbp-average-rate-contract.md`

## Tasks

| ID | Task | Status | Evidence |
|---|---|---|---|
| 0.1 | Confirm core scope and audit readiness | done | User confirmed 2026-08-26; compatibility review is additive; `ab31bd533`. |
| 1.1 | Add contracts, provenance persistence, migration, and fetch selection | pending | Focused service and validator tests. |
| 2.1 | Implement and register the NBP A/B provider | pending | Deterministic provider unit tests. |
| 3.1 | Add explicit lookup filtering and UTC fallback semantics | pending | Focused lookup-service tests. |
| 4.1 | Extend REST contracts, config/list UI, and locale files | pending | Route and component tests plus DS review. |
| 5.1 | Add integration coverage, upgrade notes, validation, and PR | pending | Test logs, migration probe, commit, PR, CI. |

## Scope

- `packages/core/src/modules/currencies` only, plus migration, docs/spec evidence, tests, and release notes.
- Existing `NBP` table-C behavior remains unchanged.
- No new dependency, cache, event, queue, or client boundary.

## Compatibility

All public changes are additive: optional selection metadata/options, an additive enum member, a nullable `external_reference` column, and an additive REST field. Existing calls and unfiltered reads retain default-provider semantics.
