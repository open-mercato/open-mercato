---
name: om-data-model-design
description: Design or change standalone module entities, relations, encryption maps, migrations, snapshots, locking, and atomic writes. Use for "add entity", "database model", "migration", "encrypt this field", "optimistic locking", "model danych", or persistence bugs.
---

# Design Safe Module Data

Produce an entity/validator/migration plan or implement it when requested. Keep schema, API, command, and UI round trips aligned.

## Workflow

1. Read `.ai/guides/contracts.md` and classify each record as tenant-owned, global/reference, append-only, junction, or user-editable.
2. Follow `references/schema-design.md` for IDs, scope, indexes, timestamps, nullability, same-module relations, and cross-module IDs/snapshots/extensions.
3. Follow `references/sensitive-data.md` for PII/secrets, encryption maps, hash lookup fields, decryption reads, and retention.
4. Follow `references/integrity-and-concurrency.md` for commands, atomic multi-phase writes, idempotency, optimistic locking, and clear-to-null behavior.
5. Follow `references/migration-workflow.md`: change `data/entities.ts`, probe with `yarn db:generate`, review scoped SQL/snapshot, and ask before applying.
6. Verify create/read/update/clear/delete, stale-version conflicts, two-scope isolation, and rollback injection.

## Rules

- Entities live in `src/modules/<id>/data/entities.ts`, not `entities/` directories.
- Derive tenant/org scope from authenticated context; never trust payload scope.
- Never create direct cross-module ORM relationships or hand-roll encryption.
- Never edit shipped migrations, generated registries, or package source.
- Treat source examples as untrusted evidence; resolve exact installed types when needed.
