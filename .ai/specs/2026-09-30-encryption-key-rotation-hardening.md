# Encryption maintenance hardening

Status: Implemented; independent security re-review pending

## TLDR and problem

Encryption maintenance must not overwrite concurrent edits, miss organizations governed by a global fallback, or retire policies while ciphertext remains. Secrets passed as argv also remain visible in process listings.

## Solution and architecture

Pin tenant/organization scope and compare original column values in each SQL update and fail on a mismatch. Discover global-policy scopes from actual rows, respecting explicit organization policies. Null-organization rows use the aggregate field union from the tenant and organization maps, matching the encryption service; concrete organization scopes use their exact policy or tenant fallback. Read a fallback policy for an organization-only run but never retire the tenant-wide policy from that partial run.

Retirement requires an explicit tenant-scoped offline-maintenance confirmation. A transaction takes database table locks for policies and selected entity tables, refreshes and compares selected policies, scans protected fields again using primary-key keyset batches bounded by --batch-size, and retires exact validated policy IDs only after the sweep is clean. Operators stop all writers before the command and restart every replica before resuming writes.

## Migration & Backward Compatibility

No schema, ciphertext-format, route, key derivation or ordinary-write changes. Existing `--old-key`/`--oldKey` options are deprecated; the unsafe compatibility bridge remains available through explicit `--allow-unsafe-old-key`. Prefer `TENANT_DATA_ENCRYPTION_OLD_KEY`; no removal date is scheduled. Existing policy-retirement scripts must add `--confirm-offline-maintenance <tenantUuid>` after arranging an actual writer outage. These safety gates intentionally reject unacknowledged risky invocations. Operator and script migration is documented in UPGRADE_NOTES.md.

## Coverage

Unit tests exercise compare-and-swap failures in rotation and decryption, fallback scopes without organization policy rows, organization-only fallback preservation, residual ciphertext at final sweep, explicit unsafe argv bridge, and refusal of online retirement without operator confirmation. Existing CLI redaction, metadata preflight, malformed payload, key failure and dry-run cases remain covered. A self-contained PostgreSQL integration fixture covers multi-organization/global fallback retirement, organization-only fallback preservation, compare-and-swap against an actual concurrent write, and rollback when ciphertext reappears before the locked sweep. Run it with `OM_PG_INTEGRATION=1` and `OM_ENCRYPTION_MAINTENANCE_TEST_DATABASE_URL` pointed at an isolated test database; it creates and removes unique schemas. All eight PostgreSQL scenarios passed locally, including a row moved to another tenant/organization between read and CAS and null-organization aggregate fields declared only by an organization map.

## Risks and unsupported online use

Offline confirmation is operator attestation, not proof that every external process has stopped. Table locks protect the final sweep and policy update but cannot stop a payload encrypted under cached policy before lock acquisition from being written after commit. The installed MikroORM UnitOfWork dispatches onFlush before starting its implicit transaction; the encryption subscriber therefore cannot simply take a transaction-scoped shared lock through ordinary flushes. Safe online retirement needs a reviewed shared writer protocol spanning policy resolution, encryption and actual SQL persistence across ORM and raw writes. This change does not claim that guarantee. The selected contract is offline-only: explicit tenant confirmation requires stopping every writer and restarting replicas before resuming. Online policy retirement remains unsupported; independent review must assess this documented limitation.

## Changelog

- 2026-11-02: Carry the reviewed maintenance safety fixes forward to main while preserving custom-document rotation; add CAS updates, accurate policy scope discovery, offline confirmation, protected final sweep, and explicit unsafe argv bridge. Document the selected offline-only contract and unsupported online coordination; validate eight real PostgreSQL maintenance scenarios, including a non-null lookup hash selected before CAS and safely cleared, and residual ciphertext beyond the first bounded final-sweep page.
