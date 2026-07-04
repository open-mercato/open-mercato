---
name: om-data-model-design
description: Design entities, relationships, and manage the migration lifecycle. Use when planning a data model, designing entities, choosing relationship patterns, adding cross-module references, or managing database migrations. Triggers on "design entity", "data model", "add entity", "database schema", "migration", "relationship", "many-to-many", "junction table", "foreign key", "jsonb", "add column".
---

# Data Model Design

Design entities, relationships, and manage the migration lifecycle following Open Mercato conventions.

## When to use

- Planning a data model: distinct entities, their fields, and how they relate (1:1, 1:N, N:M, cross-module).
- Choosing a relationship or advanced pattern (junction table, self-reference, polymorphic, ordered, audit/history, soft delete).
- Managing the migration lifecycle (`yarn db:generate` / `yarn db:migrate`, snapshots, adding/removing columns).
- Designing sensitive/PII/GDPR columns with the framework encryption-maps mechanism.
- Not for building CRUD API routes or UI on top of the model — those are separate skills.

## What it contains

The design procedure split by concern: the six-step design workflow, entity + field-type guidance, same-module relationship and cross-module FK patterns, the migration lifecycle, advanced patterns, the encryption/GDPR map mechanism, and a consolidated anti-patterns + MUST-rules checklist. Every code example, MikroORM decorator, migration command, and encryption rule lives in the `workflow/` files.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Design workflow, entity template + required columns, field/type selection, JSONB, enums, nullability | [`workflow/entities-and-fields.md`](workflow/entities-and-fields.md) |
| Same-module relationships (1:N, N:M, 1:1, self-ref) and cross-module FK-only references + enrichers | [`workflow/relationships-and-cross-module.md`](workflow/relationships-and-cross-module.md) |
| Creating/reviewing migrations, snapshots, adding/removing columns | [`workflow/migration-lifecycle.md`](workflow/migration-lifecycle.md) |
| Polymorphic refs, ordered collections, soft delete, audit/history tables | [`workflow/advanced-patterns.md`](workflow/advanced-patterns.md) |
| Sensitive data, PII/GDPR, encryption maps, `findWithDecryption`, KMS env switches | [`workflow/encryption-and-gdpr.md`](workflow/encryption-and-gdpr.md) |
| Anti-pattern table + consolidated MUST/MUST NOT rules checklist | [`workflow/anti-patterns-and-rules.md`](workflow/anti-patterns-and-rules.md) |
| MikroORM decorator/type/query cheatsheet | [`references/mikro-orm-cheatsheet.md`](references/mikro-orm-cheatsheet.md) |

## Non-negotiables

- Every tenant-scoped entity carries `organization_id` + `tenant_id` (indexed) and the standard columns; UUID v4 PKs; index all FKs.
- No ORM relationship decorators across module boundaries — use FK `uuid` columns + enrichers.
- Never rename/drop columns in one release; review generated migrations, keep only scoped changes, and update `.snapshot-open-mercato.json`. Never run `yarn db:migrate` without explicit user confirmation.
- Encrypt PII/secrets via `<module>/encryption.ts` `defaultEncryptionMaps` and read via `findWithDecryption` — never hand-roll AES/KMS or store plaintext "for now".
