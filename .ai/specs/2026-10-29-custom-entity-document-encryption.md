# Custom entity document encryption

Status: Implemented; CI validation required for the Windows-only full-suite limitation below
Issue: #7810

## TLDR and overview

Custom entity documents must honor the effective custom field definition's `encrypted` setting in JSONB storage, independently of optional EAV writes. The existing tenant encryption service owns key access and encryption.

## Problem statement

DataEngine sanitizes and validates custom entity values but persists them without encryption. The custom storage query path returns them without decryption, and the encryption CLI visits only mapped ORM entities.

## Proposed solution and architecture

Resolve definitions using existing tenant and organization precedence. Seal encrypted field values before document persistence. Preserve field names, scalar types and multi-value arrays. Authenticate existing ciphertext before retaining it to prevent nested encryption. Updates also seal legacy plaintext retained in the merged document. Authorized document queries decrypt in the row's own scope. Encrypted filters and ordering run after decryption, before pagination, honoring `OM_ENCRYPTED_SORT_MAX_ROWS` when configured; exceeding it fails explicitly rather than returning incomplete matches. LIKE matching uses a bounded wildcard algorithm.

Extend the existing rotation command to visit custom documents even without ORM encryption maps. Dry runs do not provision keys or write data. Old-key ciphertext is decrypted and resealed with the current tenant key; current-key ciphertext remains stable. Undecryptable ciphertext fails closed.

Rotation includes retained ciphertext from inactive, deleted and newly plaintext definitions. Active effective scope overrides remain authoritative for plaintext backfill and unauthenticated values; historical fallback uses scope specificity and recency. Authenticate ciphertext on plaintext fields before treating it as protected, so legal envelope-shaped text cannot block rotation. Reseal raw decrypted bytes when historical kinds are uncertain.

## Data models and API contracts

No tables, columns, routes, request/response shapes, ACLs, events, DI keys or CLI options change. Encryption helpers are internal implementation details. JSONB field values use the existing custom-field ciphertext format. Arrays retain their shape and encrypt entries individually.

## Migration & Backward Compatibility

Existing plaintext remains readable and is sealed on the next update or an existing `entities rotate-encryption-key` run without an old key. Operators must include document storage when rotating keys. Existing EAV behavior and the encryption-off mode remain unchanged. No database migration is needed.

## Implementation plan

1. Add shared internal document transformations and wire scoped definitions into DataEngine writes.
2. Decrypt custom-storage queries and preserve encrypted filter/sort behavior.
3. Extend key rotation and add regression coverage for writes, reads, legacy records, scope, arrays, dry runs and rotation.

## Integration coverage

Exercise real DataEngine serialization and real AES with a tenant key; verify JSONB payloads contain no protected plaintext. Exercise HybridQueryEngine document queries, including projected fields and organization-specific kinds. Exercise the CLI path without ORM maps and its dry-run/rotation branches. Add an opt-in PostgreSQL integration scenario proving actual JSONB persistence when an isolated database is available; never apply migrations to a developer database.

## Risks & impact review

- High: wrong scope could expose data or select the wrong kind. Preserve SQL tenant/organization predicates and use each row's scope for decryption.
- High: re-encrypting ciphertext with a different key destroys recoverability. Authenticate current ciphertext and reject unknown keys before writes.
- Medium: encrypted comparisons cannot run against ciphertext. Evaluate them after scoped decryption and fail explicitly above the configured scan limit. With no configured limit, filtering and sorting scan the scoped candidates in memory, like the existing encrypted-sort default.
- Medium: previous plaintext persists until records are rewritten. Document the existing CLI backfill operation; backups require separate operator handling.

## Final compliance report

Implemented without changes to public wire contracts, tables, CLI options or UI. Independent review's historical-rotation, scope-override and wildcard-complexity findings are resolved. Targeted checks pass: 75 shared tests (including 66 DataEngine tests), 114 query tests, 42 rotation tests, and one real PostgreSQL integration test: 232 total. The PostgreSQL test verifies actual JSONB ciphertext, authorized reads/filters, legacy partial updates, a read-only preview and successful old-to-current key rotation.

Runner: local. Both package builds around generation, translation sync/usage, full typecheck, app build, template parity, lesson validation and diff checks passed. Translation usage reports only unused-key advisories. The full `yarn test` command reached 48 successful tasks out of 49, then failed in the unchanged `create-app` lockfile test because Windows rejects `spawnSync yarn.cmd` with `EINVAL`. Docusaurus tests passed after retrying as the worktree owner to permit Git metadata reads. Default Jest globs under the Windows `.codex` path also miss package suites; affected suites were executed with explicit `--testMatch` overrides and real test counts. CI must supply the canonical full-suite result.

## Changelog

- 2026-10-30: Review autofix preserves SQL-applied common predicates and selects storage metadata columns for deferred filters. Public array predicates in mixed encrypted OR groups use hidden JSON projections without changing response types; PostgreSQL and unit regressions cover organization scoping, array matching and scalar rejection.

- 2026-10-29: Implemented and independently reviewed document encryption, scoped queries and historical-field rotation for #7810; verified against isolated PostgreSQL 17.
