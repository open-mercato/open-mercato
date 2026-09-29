# Execution plan — encryption map backfill guidance (#6701)

Source doc: https://github.com/open-mercato/open-mercato/issues/6701

## Goal

Make sure agents and developers who add an encryption map entry to a module that may already be deployed also ship a backfill migration, so pre-existing tenants stop writing that column in plaintext.

## Scope

- Docs/harness: `om-data-model-design` `references/sensitive-data.md` (step 5), `packages/core/AGENTS.md` → Encryption, `apps/docs/docs/user-guide/encryption.mdx`.
- Helper (issue follow-up): `@open-mercato/shared/lib/encryption/migration-backfill` emitting the guarded backfill SQL for a `ModuleEncryptionMap` — inserts the map for every (tenant, org) scope that already has active maps (`NOT EXISTS` guard) and appends missing field rules to existing maps. No-op when `encryption_maps` does not exist yet, so it is safe in any module regardless of migration ordering.
- Refactor the two core backfills (`entities` `Migration20260722120000`, `Migration20260822120000`) to the helper. Their `down()` stays as is.
- Mechanical check (issue follow-up), warn-only: after `db:generate`, warn about declared `(entityId, field)` pairs that existing tenant scopes in the connected database lack and that no module migration backfills. Never fails generation.

## Non-goals

- No runtime encryption behavior change, no automatic seeding of existing tenants at runtime.
- No new backfill migrations for other core modules (possible gaps are reported, not fixed here).
- No change to `seed-encryption` / `rotate-encryption-key` CLI behavior.

## Implementation Plan

### Phase 1: Backfill SQL helper

- 1.1 Add `buildEncryptionMapBackfillSql` in `packages/shared/src/lib/encryption/migration-backfill.ts` with unit tests (identifier validation, system key scope rejection, statement shape).

### Phase 2: Core migrations on the helper

- 2.1 Refactor `entities` `Migration20260722120000` and `Migration20260822120000` `up()` to the helper; keep `down()`.

### Phase 3: Warn-only check in db:generate

- 3.1 Add `packages/cli/src/lib/db/encryption-backfill-check.ts` (declared pairs vs. existing tenant maps vs. migration coverage) with unit tests.
- 3.2 Call it at the end of `dbGenerate`, swallowing every failure into a warning.

### Phase 4: Guidance

- 4.1 Harness `sensitive-data.md` step 5.
- 4.2 `packages/core/AGENTS.md` Encryption bullet and `packages/cli/AGENTS.md` note on the warning.
- 4.3 `apps/docs/docs/user-guide/encryption.mdx` section "Adding a map to a module that is already deployed".

## Risks

- Refactored migrations: already-applied migrations are not re-run (MikroORM tracks names); for installs that have not applied them yet the helper emits the same insert plus a field append that is a no-op for these entities. Low risk.
- The db:generate check reads the local database; it may report real gaps for modules added after a local tenant was created. It is advisory only and suggests `entities seed-encryption` for local repair.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backfill SQL helper

- [x] 1.1 Add buildEncryptionMapBackfillSql helper with unit tests — 8d9ee65fa

### Phase 2: Core migrations on the helper

- [x] 2.1 Refactor entities backfill migrations to the helper — 0700a19b7

### Phase 3: Warn-only check in db:generate

- [ ] 3.1 Add encryption backfill check with unit tests
- [ ] 3.2 Wire the check into dbGenerate as warn-only

### Phase 4: Guidance

- [ ] 4.1 Update om-data-model-design sensitive-data reference
- [ ] 4.2 Update core and cli AGENTS.md
- [ ] 4.3 Update the encryption user guide
