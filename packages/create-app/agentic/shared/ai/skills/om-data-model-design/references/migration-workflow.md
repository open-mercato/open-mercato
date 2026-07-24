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
