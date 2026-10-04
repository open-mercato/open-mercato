# Encryption Map Scope Uniqueness

## TLDR

Encryption-map materialization must be a database-enforced singleton for each entity and nullable tenant/organization scope. Seeders use one atomic upsert, legacy duplicates are collapsed without dropping encryption coverage, and runtime reads merge duplicates deterministically until every database has migrated.

## Overview

`encryption_maps` decides which entity fields are encrypted at rest. Module declarations are materialized by the entities CLI during tenant setup, by upgrade actions, and by the management API. Runtime encryption resolves maps in organization, tenant-global, then global order.

## Problem Statement

The current schema has a non-unique lookup index only. CLI/setup/upgrade-action and API writers all perform `findOne` followed by `insert`, so concurrent processes can create multiple live rows for the same scope. Runtime and management reads then select one duplicate without ordering. If the duplicates differ, an arbitrary row can omit a field and cause a later write to store that field as plaintext.

The affected logical key is `(entity_id, tenant_id, organization_id)`. Both scope columns are nullable: `NULL` tenant plus `NULL` organization is the global scope, while a `NULL` organization under a tenant is the tenant-global scope. Ordinary PostgreSQL unique indexes treat NULLs as distinct and therefore do not protect either scope.

## Proposed Solution

1. Retain the existing non-unique lookup index and add a partial unique index over live rows with `NULLS NOT DISTINCT` and `WHERE deleted_at IS NULL`.
2. Before creating the index, deterministically choose the oldest `(created_at, id)` live row per scope as canonical. Merge field declarations from active duplicates (or all duplicates when none is active), preferring the earliest non-null `hashField` for each field. Soft-delete and deactivate every losing row.
3. Replace check-then-insert seeding with one `INSERT ... ON CONFLICT ... DO UPDATE` helper shared by the CLI, tenant setup through that CLI, upgrade actions, and the management API.
4. Order runtime duplicate reads by `(created_at, id)` and union their fields with first-declaration precedence plus later non-null hash completion. Log duplicate detection without logging field values or encrypted data.
5. Apply the same deterministic canonical resolution in the management API so a pre-migration rolling deployment cannot expose or overwrite an arbitrary duplicate.

## Architecture

The entities module owns the persistent invariant and the atomic write helper. The shared encryption service remains independent of core and implements the defensive duplicate merge at its raw SQL read boundary. No route URL, CLI command, module declaration, encryption algorithm, KMS behavior, cache key, or public request/response shape changes.

All materializers converge through the entities helper:

- `entities seed-encryption`, including `mercato init`
- device and phone-call encryption-map upgrade actions
- `POST /api/entities/encryption`

Historical SQL backfill migrations remain unchanged. They run sequentially before the new uniqueness migration on a fresh database; on an upgraded database the new index protects any later write.

## Data Models

`EncryptionMap` keeps every existing column. The additive index is:

```sql
create unique index encryption_maps_entity_scope_live_unique
on encryption_maps (entity_id, tenant_id, organization_id)
nulls not distinct
where deleted_at is null;
```

Soft-deleted history is excluded and may contain repeated logical keys. Exactly one non-deleted row may exist for each global, tenant-global, or tenant+organization key.

## API Contracts

`GET /api/entities/encryption` and `POST /api/entities/encryption` retain their methods, URL, payloads, status codes, optimistic-lock header behavior, mutation guards, and response fields. POST becomes atomic at creation time. GET deterministically represents a duplicate scope during rolling deployment.

The `entities seed-encryption` command and exported `upsertEncryptionMapSpecs` signature remain compatible.

## Test Coverage

- Atomic-upsert unit coverage starts overlapping seeders for one nullable scope and asserts one active canonical record.
- API coverage asserts POST uses the atomic helper and duplicate GET data resolves deterministically without dropping active fields.
- Shared-service coverage supplies duplicate rows with disjoint fields and conflicting hash metadata, then proves all fields remain encrypted and precedence is deterministic.
- Migration coverage pins canonical ordering, active-row field union, loser soft deletion, `NULLS NOT DISTINCT`, and the live-row predicate.
- Integration coverage runs simultaneous CLI and API seed requests against a real database and asserts exactly one live active row for tenant-global and organization scopes. A temporary-table migration fixture proves deterministic active-field union, oldest-row canonicalization, loser soft deletion, and global `NULL/NULL` uniqueness without mutating application data.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| NULL scopes bypass uniqueness | Critical | `NULLS NOT DISTINCT` covers both nullable scope columns | Requires PostgreSQL 15+, already a platform assumption |
| Deduplication drops an encrypted field | Critical | Union active duplicate fields before retiring losers | Conflicting hash targets use deterministic earliest non-null precedence |
| Rolling deploy reads duplicates before migration | High | Runtime union plus deterministic ordering | A stale process can retain a cached pre-deploy map until its normal TTL |
| Retrying a seeder changes encryption declarations | Medium | Atomic upsert preserves the existing update/reactivate semantics | Concurrent callers with intentionally different specs remain last-writer-wins, as before |
| Migration destroys auditability | Medium | Losers are soft-deleted and retained | Down migration removes the index but intentionally does not recreate duplicates |

## Migration & Backward Compatibility

This is an additive database invariant: no table, column, index, route, command, identifier, type, or import path is removed or renamed. The existing lookup index remains intact. The migration repairs only an invalid state that the public model already treated as a singleton.

Client action: none. Existing API and CLI callers keep the same contracts.

Operator action: run the normal deployment migration before starting the new application version. Do not manually delete duplicate rows; the migration deterministically merges encryption fields and soft-deletes losers. Rollback may drop the unique index, but the deduplication is intentionally not reversed because recreating ambiguous live rows would restore the vulnerability.

## Final Compliance Report

- Tenant/global scope: nullable values are compared as equal by the database invariant.
- Encryption behavior: field-level AES/KMS behavior, scope fallback, and cache contracts are unchanged; defensive reads can only add missing encryption coverage.
- Backward compatibility: additive index and internal implementation changes only; public contracts are preserved.
- Migration workflow: module-scoped migration and `.snapshot-open-mercato.json` update; migration is not applied locally.
- Logging: duplicate diagnostics contain entity/scope identifiers and counts only, never plaintext, ciphertext, fields, or keys.

## Changelog

- 2026-10-04: Spec authored after revalidating the live schema, all materialization entry points, runtime readers, and existing coverage.
