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
3. Replace check-then-insert seeding with one `INSERT ... ON CONFLICT ... DO UPDATE` helper shared by the CLI, tenant setup through that CLI, upgrade actions, and the management API. Execute that statement through the caller's `EntityManager` so an enclosing setup or upgrade transaction owns the write and can roll it back.
4. Order runtime duplicate reads by `(created_at, id)` and union their fields with first-declaration precedence plus later non-null hash completion. Log duplicate detection without logging field values or encrypted data.
5. Apply the same deterministic canonical resolution in the management API so a pre-migration rolling deployment cannot expose or overwrite an arbitrary duplicate.

## Architecture

The entities module owns the persistent invariant and the atomic write helper. The shared encryption service remains independent of core and implements the defensive duplicate merge at its raw SQL read boundary. No route URL, CLI command, module declaration, encryption algorithm, KMS behavior, cache key, or public request/response shape changes.

All live materializers converge through the entities helper:

- `entities seed-encryption`, including `mercato init`
- auth tenant bootstrap's initial module-map materialization
- the integrations credential service's on-demand map materialization
- device and phone-call encryption-map upgrade actions
- `POST /api/entities/encryption`

The audit also covered the only historical direct SQL writers, `Migration20260722120000` and `Migration20260822120000`; both are migration-time backfills rather than live application writers. Runtime readers are the shared exact/fallback and all-organizations aggregate resolver, the deterministic management API reader, and search's fail-closed cross-scope union reader.

The helper returns the scopes it materialized. Upgrade execution supplies an additive post-commit callback registrar; device and phone-call actions register exact-scope invalidation there, and the callbacks run only after the outer action transaction has committed. `TenantDataEncryptionService.invalidateMap` removes both the exact map tag and the tenant-wide all-organizations aggregate tag, including positive, negative, in-flight, memory, and configured shared-cache entries. A rolled-back action never runs those callbacks.

The integrations credentials writer uses the same rule. Its existing `save` contract accepts an optional post-commit callback registrar. Autocommit callers keep immediate invalidation; the `sync_excel` import route, which saves credentials inside a larger mapping/credentials/state transaction, collects the callback and runs it only after that transaction resolves. A rollback discards the callback.

The CLI intentionally remains per-map autocommit. It invalidates each scope immediately after that scope's upsert succeeds, so a later failed module declaration cannot leave an earlier committed map hidden behind a stale cache entry. Transactional callers of the exported multi-spec helper continue to collect its returned scopes and invalidate only after their owning commit.

Map-cache invalidation advances process-global epochs for the exact, aggregate, and entity-wide search-policy tags, clears local state, and synchronously registers every shared-cache mutation before awaiting any of them. Every database read, shared-cache read, and shared-cache write captures and rechecks its epoch; an invalidated in-flight hit or miss retries instead of returning or repopulating stale data. Shared-cache set/delete operations are serialized per tag, preserving `old set → invalidate delete → fresh set` ordering when invalidation overlaps an asynchronous cache write. A failed invalidation leaves that tag fail-closed until a later invalidation succeeds.

Historical SQL backfill migrations remain unchanged. They run sequentially before the new uniqueness migration on a fresh database; on an upgraded database the new index protects any later write.

The search package remains independent of core. When encrypted-field exclusion is enabled, its database reader loads every active live map for the entity across global, tenant-global, and organization scopes, applies a stable scope/creation/id ordering, and unions field rules locally. A lookup error aborts indexing, and an empty result is not cached. A positive policy is retained only with the entity-wide mutation version maintained by the shared encryption invalidation contract; the resolver checks that version both before and after its database read and retries if it changes. Without a configured shared cache/version channel it does not retain positive policies. A newly materialized field therefore cannot remain hidden behind the old five-minute policy.

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

`GET /api/entities/encryption` and `POST /api/entities/encryption` retain their methods, URL, payloads, optimistic-lock header behavior, mutation guards, and successful response fields. POST becomes atomic at creation time. GET deterministically represents a duplicate scope during rolling deployment. POST returns an additive generic `503 encryption_map_invalidation_failed` response after a committed write whose cache invalidation cannot complete; it never reports success or exposes the cache backend error.

The `entities seed-encryption` command and exported `upsertEncryptionMapSpecs` signature remain compatible.

## Test Coverage

- Atomic-upsert unit coverage starts overlapping seeders for one nullable scope and asserts one active canonical record.
- Transaction coverage asserts the upsert uses the caller `EntityManager` executor rather than the raw pooled connection, then deliberately fails an outer upgrade transaction against PostgreSQL and proves the map row is absent after rollback.
- Auth bootstrap and integrations credential writer coverage starts overlapping materializers for one scope and asserts that both use the conflict-safe path; credentials coverage also pins cache invalidation.
- API coverage asserts POST uses the atomic helper and duplicate GET data resolves deterministically without dropping active fields.
- Shared-service coverage supplies duplicate rows with disjoint fields and conflicting hash metadata, then proves all fields remain encrypted and precedence is deterministic.
- Search coverage pins duplicate merging, cross-scope union, fail-closed lookup errors, retry after failure, and non-caching of empty results.
- Migration coverage pins canonical ordering, active-row field union, loser soft deletion, `NULLS NOT DISTINCT`, and the live-row predicate.
- Integration coverage runs simultaneous CLI and API seed requests against a real database and asserts exactly one live active row for tenant-global and organization scopes. A temporary-table migration fixture proves deterministic active-field union, oldest-row canonicalization, loser soft deletion, and global `NULL/NULL` uniqueness without mutating application data.
- Cache regressions prime both exact and aggregate positive entries and an exact negative entry, change the backing map, and prove post-commit invalidation exposes the fresh coverage immediately. Upgrade-service regressions prove invalidation runs after commit and is skipped on rollback.
- Deterministic epoch regressions suspend an exact hit, exact miss, and all-organizations aggregate database read across invalidation; each first caller retries to the committed value, the next caller sees that value, and the database read count is exactly two rather than the vulnerable stale/stale count of one. A shared-cache regression also suspends an aggregate set and proves the ordering is stale set, invalidate delete, then fresh refill.
- A blocked-first-delete regression starts exact and aggregate reads from a second service while the exact shared-cache delete is suspended, proving the aggregate mutation barrier was already registered and both the racing and subsequent reads are fresh. A failed-delete regression proves the stale shared value cannot be read and a later successful invalidation restores fresh reads.
- Search coverage primes a non-empty policy, adds a newly protected field, invalidates through the shared service contract, and proves the next lookup reloads the expanded policy rather than retaining the old field set.
- Management API coverage forces invalidation failure after persistence and proves the response is a generic non-success without backend details; the mutation after-success hook does not run before cache coherence is established.
- Sync Excel route coverage proves deferred credential-map invalidation occurs after the outer transaction's commit and is absent after rollback. CLI coverage commits one map, fails the next, and proves the completed scope was already invalidated.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
| --- | --- | --- | --- |
| NULL scopes bypass uniqueness | Critical | `NULLS NOT DISTINCT` covers both nullable scope columns | Requires PostgreSQL 15+, already a platform assumption |
| Deduplication drops an encrypted field | Critical | Union active duplicate fields before retiring losers | Conflicting hash targets use deterministic earliest non-null precedence |
| Rolling deploy reads duplicates before migration | High | Runtime union plus deterministic ordering | A stale process can retain a cached pre-deploy map until its normal TTL |
| A map commits while a cached hit or miss still describes the old scope | Critical | Advance exact/all-organizations/search-policy epochs and register every mutation barrier before the first await; stale in-flight database and shared-cache operations retry and cannot refill any policy cache | A shared-cache backend outage is surfaced as an action failure and leaves reads fail-closed until retry |
| Search retains a non-empty policy after a map adds a field | Critical | Version positive policies with the shared entity-wide invalidation tag and recheck around the database read; disable positive retention without that version channel | Each lookup performs one shared-cache version read when positive retention is active |
| An outer setup/upgrade transaction fails after map materialization | Critical | Execute the upsert through the transactional EM; discard deferred invalidations on rollback | None in the database/cache ordering covered here |
| A credentials map invalidates inside a larger transaction that later rolls back | Critical | Optional post-commit registrar on credentials writes; `sync_excel` runs callbacks only after its outer commit | Other callers remain autocommit and invalidate immediately |
| A later CLI spec fails after earlier autocommits | Critical | Invalidate each successfully materialized scope before advancing to the next spec | The command reports the later failure while completed writes remain cache-coherent |
| Retrying a seeder changes encryption declarations | Medium | Atomic upsert preserves the existing update/reactivate semantics | Concurrent callers with intentionally different specs remain last-writer-wins, as before |
| Migration destroys auditability | Medium | Losers are soft-deleted and retained | Down migration removes the index but intentionally does not recreate duplicates |

## Migration & Backward Compatibility

This is an additive database invariant: no table, column, index, route, command, identifier, type, or import path is removed or renamed. The existing lookup index remains intact. The migration repairs only an invalid state that the public model already treated as a singleton. The management route adds a documented 503 error response for the case that previously returned a false success despite failed invalidation; successful request and response contracts are unchanged.

Client action: none. Existing API and CLI callers keep the same contracts.

Operator action: run the normal deployment migration before starting the new application version. Do not manually delete duplicate rows; the migration deterministically merges encryption fields and soft-deletes losers. Rollback may drop the unique index, but the deduplication is intentionally not reversed because recreating ambiguous live rows would restore the vulnerability.

## Final Compliance Report

- Tenant/global scope: nullable values are compared as equal by the database invariant.
- Encryption behavior: field-level AES/KMS behavior and runtime scope fallback are unchanged; live writers invalidate affected map caches, and defensive reads can only add missing encryption coverage.
- Backward compatibility: additive index and internal implementation changes only; public contracts are preserved.
- Migration workflow: module-scoped migration and `.snapshot-open-mercato.json` update; migration is not applied locally.
- Logging: duplicate diagnostics contain entity/scope identifiers and counts only, never plaintext, ciphertext, fields, or keys.

## Changelog

- 2026-10-04: Closed final security review 428ec348: registered every invalidation barrier before the first cache await, versioned Search's positive encryption policy through the shared invalidation tag, persisted failed invalidations as fail-closed barriers, and made the management POST return a safe 503 instead of false success.
- 2026-10-04: Closed the final transaction/cache review blockers with deferred `sync_excel` credential invalidation, per-tag cache epochs and serialized shared-cache mutations, per-autocommit CLI invalidation, and deterministic hit/miss/aggregate plus commit/rollback/partial-failure tests.
- 2026-10-04: Added the auth and integrations writers plus the package-local search reader to the audited inventory; specified fail-closed search lookup/cache behavior.
- 2026-10-04: Bound canonical upserts to the caller transaction, added post-commit exact/aggregate invalidation for live upgrade actions, and added rollback plus primed hit/miss regressions.
- 2026-10-04: Spec authored after revalidating the live schema, all materialization entry points, runtime readers, and existing coverage.
