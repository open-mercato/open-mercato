# PLAN — CrudForm field-persistence integration sweep (foundation)

**Source umbrella:** https://github.com/open-mercato/open-mercato/issues/2466
**Prior manual-QA run:** `.ai/runs/2026-06-04-crudform-qa-2466/` (browser sweep + 5 bugs filed)
**This run:** authoring **automated** integration tests that prove every CrudForm surface
persists all fields (scalars, dictionaries, **custom fields**, multiselect/arrays) on
create + update, gated behind `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED`.

This PR delivers the **foundation only** (shared harness + skip-gate + docs + one reference
module). Per-module coverage ships as separate stacked PRs tracked in `MODULE-LEDGER.md`.

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. On landing a Step, flip to `done`
> and fill the short SHA. First non-`done` row is the resume point.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Run-folder plan + module ledger (seed commit) | done | seed |
| 1 | 1.2 | Shared harness: env skip-gate + tolerant field/CF assertions + makeCrud round-trip runner | done | 2de7d217a |
| 1 | 1.3 | Jest unit tests for harness pure logic (env parse, dual-shape CF assertion) | done | 9ebc56b66 |
| 1 | 1.4 | Currencies reference integration spec + meta (scalar round-trip via harness) | done | 9ebdfebe5 |
| 1 | 1.5 | Document flag + harness + re-run procedure in `.ai/qa/AGENTS.md` | done | 8e50cbbab |

## Goal

A reusable, re-runnable automated verification that CrudForm saves persist every field
type — so #2466's manual sweep becomes a CI-able regression net.

## Scope (this PR)

- `packages/core/src/helpers/integration/crudFormPersistence.ts` — shared harness.
- `packages/core/src/helpers/integration/__tests__/crudFormPersistence.test.ts` — unit tests.
- `packages/core/src/modules/currencies/__integration__/TC-CUR-CRUDFORM-001.spec.ts` + `meta.ts`.
- `.ai/qa/AGENTS.md` — sweep documentation + the env flag contract.
- `.ai/runs/2026-06-04-crudform-integration-tests/*` — tracking.

## Non-goals (this PR)

- Per-module CrudForm specs beyond the currencies reference (those are stacked PRs — see ledger).
- Touching any production module code / behavior. **Tests only.**
- The EAV custom-record surface (owned by another agent per #2466).

## Env flag contract

- `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default **false** → tests run).
- When truthy (`1`/`true`/`yes`), every CrudForm-persistence spec calls `test.skip(...)` in
  `beforeAll`, so the sweep can be disabled wholesale without deleting specs.
- Parsed via `parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`.

## Risks

- Integration specs require a running seeded app (BASE_URL, default :3000) or the ephemeral
  runner; CI `yarn test` covers only the jest unit portion. Integration green is verified via
  `yarn test:integration` / ephemeral runner at checkpoint/final-gate.
- Currency `code` is unique incl. soft-deleted rows (prior run hit a dup 500). Spec uses a
  random 3-letter code and deletes its fixture in `finally`.

## Stacked-PR strategy

Per-module PRs branch off `feat/crudform-integration-tests` (this branch) so they get the
harness, and target `develop`. They go fully green once this foundation merges. Order +
status live in `MODULE-LEDGER.md`.
