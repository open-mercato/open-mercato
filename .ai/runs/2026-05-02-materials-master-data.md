# auto-create-pr — Materials Master Data Phase 1

**Date:** 2026-05-02
**Owner:** Kuba74
**Branch:** `feat/materials-master-data`
**Source spec:** [`.ai/specs/2026-05-02-materials-master-data.md`](../specs/2026-05-02-materials-master-data.md)
**Pre-implementation analysis:** [`.ai/specs/analysis/ANALYSIS-2026-05-02-materials-master-data.md`](../specs/analysis/ANALYSIS-2026-05-02-materials-master-data.md)

## Goal

Implement Phase 1 of the `materials` core module — the ERP master data foundation that unblocks `inventory`, `procurement`, `production`, and `quality` specs. Deliver a fully functional, self-contained module mirroring the `customers` reference pattern, with all 16 steps from the spec's Progress checklist.

## Scope

- **In scope:** All Phase 1 steps from the spec — `Material`, `MaterialUnit`, `MaterialSupplierLink`, `MaterialPrice`, `MaterialLifecycleEvent`, `MaterialCatalogProductLink` (extension), CRUD APIs, backend pages, FX subscriber, expiration worker, search config, custom fields, widget injection (with new spot registration in `catalog` and `customers`), setup defaults, documentation, full validation gate.
- **Out of scope:** Phase 2 PIM features, CAD/drawings, ABC analysis, kits, customer-supplied materials. ERP-specific roles (`procurement`, `production_planner`, `sales`) — deferred to separate `auth-erp-roles` spec.

## Affected Modules / Packages

- **New:** `packages/core/src/modules/materials/` (entire module)
- **Extended:** `packages/core/src/modules/catalog/widgets/injection-table.ts` (new spot `page:catalog.product.sidebar`)
- **Extended:** `packages/core/src/modules/customers/` (new file `widgets/injection-table.ts` with `page:customers.company.tabs`)
- **Read-only consumer:** `packages/core/src/modules/currencies/` (subscribe to `currencies.exchange_rate.updated`)
- **App registration:** `apps/mercato/src/modules.ts` (enable `materials`)
- **Generated:** `apps/mercato/.mercato/generated/*` (via `yarn generate`)

## Implementation Strategy

The 16 spec steps are organized into 4 phases for git history clarity. Each phase ends in a working state. Tests are mandatory per code change. Validation gate runs after every phase that touches packages.

### Lessons & constraints (from spec + `.ai/lessons.md`)

These apply to every commit:
- `crypto.randomUUID()` for parent IDs in parent-child create flows (Material → children).
- Forked EM in `buildLog()` for accurate `snapshotAfter`.
- `extractUndoPayload<T>` from `@open-mercato/shared/lib/commands/undo` — never duplicate.
- `findOneWithDecryption` for cross-module FK validation — never raw `em.findOne`.
- Wildcard-aware `hasFeature`/`hasAllFeatures` for visibility logic.
- Soft-delete cascade implemented in delete commands (events + audit).
- Partial unique indexes via raw `@Index({ expression: '... where deleted_at is null' })`.
- `em.flush()` before relation-sync queries.
- After enabling a new module in `apps/mercato/src/modules.ts`: `yarn generate && yarn mercato configs cache structural --all-tenants`.

## Risks (brief)

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Database migrations require running PostgreSQL — local Postgres on `localhost:5432` confirmed available pre-flight | Use `apps/mercato/.env` `DATABASE_URL`; if migration fails, abort and surface error |
| 2 | `yarn install` in worktree may take 3–5 min on first run | Acceptable — runs once per worktree |
| 3 | `gh pr create` requires gh authenticated as Kuba74 (✅) and write to fork `Kuba74/openm` (✅) | Confirmed in pre-flight |
| 4 | Long autonomous run — likely cannot finish all 4 phases in one session | Plan supports incremental commits + `auto-continue-pr` resumption from any unchecked step |
| 5 | New widget spots in `catalog` and `customers` — additive but cross-module | Per BC contract surface #6, adding spots is allowed; we register and consume in same PR for atomic visibility |

## External References

None used (no `--skill-url` provided). Reference is the project's own spec and `customers` module pattern.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Foundation (Steps 1.1–1.4)

- [ ] 1.1 Module scaffold — folder, `index.ts`, `acl.ts`, `di.ts`, `setup.ts` skeleton, register in `apps/mercato/src/modules.ts`, run `yarn generate` + structural cache purge
- [ ] 1.2 `Material` entity + migration (`yarn db:generate`) + zod validators in `data/validators.ts`
- [ ] 1.3 Material CRUD API routes via `makeCrudRoute` + OpenAPI exports + undoable commands with custom field hooks
- [ ] 1.4 Backend list/create/detail pages (`DataTable` + `CrudForm`) + `translations.ts` declaring `name`/`description`

### Phase 2: Master data — children (Steps 2.1–2.3)

- [ ] 2.1 `MaterialUnit` entity + migration + API routes + units tab on Material detail page (base-unit invariant, default-per-usage uniqueness validators)
- [ ] 2.2 `MaterialSupplierLink` entity + migration + API + suppliers tab + cross-org validator (`findOneWithDecryption` against `customer_companies`); preferred-flag toggle with partial unique index
- [ ] 2.3 `MaterialPrice` entity + migration + API + prices tab + currency dropdown sourced from `currencies` module; validity-range validation

### Phase 3: Async + lifecycle (Steps 3.1–3.3)

- [ ] 3.1 FX recompute subscriber `subscribers/recompute-base-currency.ts` listening to `currencies.exchange_rate.updated`; emits `materials.price.fx_recalculated`
- [ ] 3.2 Lifecycle endpoint `POST /api/materials/[id]/lifecycle` + `MaterialLifecycleEvent` audit entity + emits `materials.material.lifecycle_changed`; state machine `draft↔active→phase_out→obsolete` with optional `replacement_material_id`
- [ ] 3.3 Price expiration worker `workers/expire-prices.ts` (queue `materials.price-expiry`, daily idempotent); emits `materials.price.expired`

### Phase 4: Integration + finalize (Steps 4.1–4.6)

- [ ] 4.1 Search config (`search.ts`) with `MATERIAL_ENTITY_FIELDS`, custom field sources, fulltext + vector strategy + `formatResult`. Register `material` as custom-fields-extensible in `ce.ts` with `entityId: 'materials:material'` and ship default custom fields (`internal_notes`, `safety_data_sheet_url`)
- [ ] 4.2 `MaterialCatalogProductLink` extension entity declared in `data/extensions.ts` + migration + link/unlink API + cross-org validator
- [ ] 4.3 Widget injection — register new spots `page:catalog.product.sidebar` (in `catalog/widgets/injection-table.ts`) and `page:customers.company.tabs` (in newly-created `customers/widgets/injection-table.ts`); implement materials' two injection widgets with wildcard-aware `hasFeature` visibility
- [ ] 4.4 Setup defaults — `setup.ts` finalized: kinds dictionary seed, default custom fields registered, `defaultRoleFeatures` mapping `admin` (full) + `employee` (operational)
- [ ] 4.5 Documentation — module `AGENTS.md` + `README.md` + update root `AGENTS.md` Task Router with materials row
- [ ] 4.6 Full validation gate — `yarn lint`, `yarn build:packages`, `yarn generate`, `yarn build:packages` (post-generate), `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`, plus `yarn mercato configs cache structural --all-tenants`. Self code-review + BC review.

## Changelog

- 2026-05-02 — Plan drafted from spec's 16-step Progress checklist, organized into 4 phases. Pre-flight verified: `gh` authenticated (Kuba74), fork `Kuba74/openm` created, remotes rewired (`origin=fork`, `upstream=open-mercato`), local PostgreSQL available, `node_modules` present, `apps/mercato/.env` exists.
