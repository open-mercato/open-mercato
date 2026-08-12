# Migration Workflow

Load this reference whenever entity metadata changes.

1. Update `data/entities.ts`, validators, commands, API projections, UI fields, encryption maps, and tests as one contract change.
2. Run `yarn generate` when discovery/entity registration changed.
3. Run `yarn db:generate` as a probe; inspect all SQL and snapshot changes.
4. Remove unrelated generator churn. If scoped SQL must be written from known metadata, follow the module's existing migration style and update only its snapshot.
5. Verify forward migration semantics, uniqueness/index names, nullable/default/backfill behavior, and safe rollback/compatibility strategy.
6. Never modify a shipped migration. Add a new one.
7. Ask before `yarn db:migrate`, greenfield reset, or changing a database target.

Normal delivery stops after migration file/snapshot/tests; local applied state is not a PR artifact.

Canonical example source — the shape `yarn db:generate` produces and diffs against: [`migrations/Migration20251030150038.ts`](../../../../src/modules/example/migrations/Migration20251030150038.ts), [`migrations/Migration20260226161000_example.ts`](../../../../src/modules/example/migrations/Migration20260226161000_example.ts), and the module-scoped [`migrations/.snapshot-open-mercato.json`](../../../../src/modules/example/migrations/.snapshot-open-mercato.json). Read them for style; never copy a migration into your own module.
