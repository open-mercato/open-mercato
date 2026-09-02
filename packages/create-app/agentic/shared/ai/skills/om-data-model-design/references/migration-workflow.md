# Migration Workflow

Load this reference whenever entity metadata changes.

1. Update `data/entities.ts`, validators, commands, API projections, UI fields, encryption maps, and tests as one contract change.
2. Run `yarn generate` when discovery/entity registration changed.
3. Run `yarn db:generate` as a probe; inspect all SQL and snapshot changes.
4. Remove unrelated generator churn. If scoped SQL must be written from known metadata, follow the module's existing migration style and update only its snapshot.
5. Verify forward migration semantics, uniqueness/index names, nullable/default/backfill behavior, and safe rollback/compatibility strategy.
6. Declare the query-index projections the migration invalidated (see below).
7. Never modify a shipped migration. Add a new one.
8. Ask before `yarn db:migrate`, greenfield reset, or changing a database target.

## Data migrations MUST declare the projections they invalidate

A migration that rewrites the VALUES of a column in raw SQL — a backfill, a rename, a
normalization — bypasses every CRUD/indexer helper that would emit `query_index.upsert_one`.
`entity_indexes.doc`, and every `search_tokens` row derived from it, then keeps the
pre-migration value permanently, with no failing job and no moved `updated_at` to signal it.
Global search and any `like`/`ilike` list filter routed through the token index then match the
record by its OLD text and miss its NEW text.

A migration cannot emit the refresh itself — it holds no DI container, and the projection must
only be rebuilt once its own transaction has committed. So it **declares**, and
`mercato db migrate` discharges the obligation after the run:

```ts
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex(['my_module:my_entity'])
```

- Required whenever the migration changes stored values of a column on an entity whose CRUD route
  sets `indexer: { entityType }`. Pure `ADD COLUMN`/`CREATE TABLE` DDL with no backfill needs nothing.
- Identifiers are `module:entity` (snake_case, exactly the `indexer.entityType` value). Use the
  helper rather than a bare array literal — it throws on a malformed identifier at import time,
  whereas a hand-written literal is only reported as a warning during `db migrate`.
- Both originals forward-only? A follow-up migration that carries **only** the declaration and
  executes no SQL is the repair route for installs that already applied the original.

Normal delivery stops after migration file/snapshot/tests; local applied state is not a PR artifact.

Canonical example source — the shape `yarn db:generate` produces and diffs against: [`migrations/Migration20251030150038.ts`](../../../../src/modules/example/migrations/Migration20251030150038.ts), [`migrations/Migration20260226161000_example.ts`](../../../../src/modules/example/migrations/Migration20260226161000_example.ts), and the module-scoped [`migrations/.snapshot-open-mercato.json`](../../../../src/modules/example/migrations/.snapshot-open-mercato.json). Read them for style; never copy a migration into your own module.
