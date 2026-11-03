# Pre-Implementation Analysis: Atomic storage quota reservations

## Executive Summary

The specification is ready to implement after plan fusion. It uses an additive, tenant-scoped ledger and short PostgreSQL transaction locks, keeps object I/O outside database transactions, preserves stable APIs with optional additions, and defines fail-closed compensation and stale recovery for each upload source.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| 2/3 | Stable interfaces and signatures | Built-in drivers need deterministic path preparation; signed upload benefits from a declared byte count | Warning | Add optional members/fields only; retain existing method parameters and response fields |
| 8 | Database schema | A durable reservation table is required | Warning | Add a new table and indexes; generate the migration and synchronize the attachment snapshot |
| 9 | DI service names | A shared coordinator must be resolvable by core and storage-s3 | Warning | Add `attachmentQuotaService`; do not rename or alter existing DI keys |

### Missing BC Section

None. The spec includes migration, legacy standalone-object reconciliation, and explicit compatibility rules.

## Spec Completeness

### Missing Sections

None. UI/UX and caching are explicitly N/A because this is a backend accounting lifecycle.

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Integration coverage | A real database concurrency test may be expensive in the unit suite | Add a focused service test that controls two admissions at the tenant lock and retain route-level compensation tests |
| Legacy reconciliation | Core attachment admission cannot inspect provider-only legacy keys | Preserve provider listing/reconciliation before provider admission and document the bounded transition risk, as the spec does |

## AGENTS.md Compliance

### Violations

None identified. The proposed table is module-owned, scope columns are required, no cross-module ORM relationship is introduced, no generated file is hand-edited, and provider-specific inspection remains in storage-s3.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Compensation deletion fails | Orphan object and capacity drift | Keep the reservation counted and retry recovery; never release on failed delete |
| Accounting error or invalid numeric result | Quota bypass | Typed fail-closed error before object I/O |
| Signed URL bypass | Unaccounted direct object | Reserve before signing and reconcile the exact key/actual size at expiry |
| Multi-process concurrency | Oversubscription | Tenant-keyed advisory transaction lock covering only accounting queries and ledger write |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy standalone objects are not yet in the ledger | Under-counted provider usage | Retain scoped listing and idempotently reconcile direct keys before provider admission |
| Overwrite of an existing standalone key | Temporary double counting or stale committed row | Count the pending replacement conservatively, then replace committed rows for the target path only after storage succeeds |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Tenant lock contention | Higher latency for one tenant | Keep the transaction short and indexed; no provider calls inside it |

## Gap Analysis

### Critical Gaps (Block Implementation)

None.

### Important Gaps (Should Address)

- Deterministic paths: built-in local and S3 drivers must know the cleanup key before object I/O; the optional driver contract must fail closed or retain recovery data for unsupported external drivers.
- Signed reconciliation: missing objects release, valid objects commit actual size, oversized objects delete, and provider errors retain the reservation.
- Delete accounting: both standalone delete APIs and the DI `StorageService.delete()` must remove committed ledger usage only after provider deletion succeeds.

### Nice-to-Have Gaps

- Operational metrics for retained stale reservations can be added later without changing the correctness model.

## Remediation Plan

### Before Implementation (Must Do)

1. Freeze red regression tests for concurrent admission, fail-closed accounting, compensation, and stale recovery.
2. Keep the ledger lifecycle internal to the attachment module and expose it through the additive DI service.

### During Implementation (Add to Spec)

1. Record the final entity/index names and signed-upload optional fields.
2. Record any generated migration filename and the exact focused tests.

### Post-Implementation (Follow Up)

1. Update the spec changelog and compliance review with verification evidence.

## Recommendation

Ready to implement.
