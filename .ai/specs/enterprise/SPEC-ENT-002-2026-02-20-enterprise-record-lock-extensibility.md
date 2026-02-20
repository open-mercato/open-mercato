# SPEC-ENT-002: Enterprise-Only Record Locking via Mutation Guard Extensibility

## TLDR

Move record-lock enforcement behind a generic CRUD mutation-guard contract in `@open-mercato/shared`, and implement the concrete record-lock guard in `@open-mercato/enterprise` only. Core modules stop importing record-lock UI hooks/components directly. Locking is enabled for all resources by default via enterprise settings seed.

## Problem Statement

- Record-locking behavior leaked into shared/core/ui layers using record-lock-specific APIs and UI components.
- This made enterprise behavior visible in OSS-oriented module code and increased coupling.
- Record lock support should apply consistently across all entities without per-module lock plumbing.

## Proposed Solution

1. Add a neutral mutation-guard extension contract in `packages/shared/src/lib/crud/mutation-guard.ts`.
2. Use that contract in `makeCrudRoute` PUT/DELETE execution flow.
3. Register an enterprise adapter (`crudMutationGuardService`) that delegates to `recordLockService`.
4. Update non-CRUD custom routes to call the same generic guard contract.
5. Remove direct record-lock UI imports from core customer/sales detail pages.
6. Seed record-lock settings with `enabledResources: ['*']` and normalize wildcard support.

## Architecture

### Shared (infrastructure only)

- New contract:
  - `validateCrudMutationGuard(container, input)`
  - `runCrudMutationGuardAfterSuccess(container, input)`
- `makeCrudRoute` calls guard before mutation and after success for PUT/DELETE.
- Shared no longer imports record-lock-specific helper from CRUD factory execution path.

### Enterprise (feature implementation)

- `createRecordLockCrudMutationGuardService(recordLockService)` adapts generic guard input/output to record-lock validation/release.
- DI registration exposes `crudMutationGuardService`.
- Record-lock header parsing remains inside enterprise (`readRecordLockHeaders`).

### Core/UI consumption

- Core routes/components use normal API operations and generic errors only.
- No direct `@open-mercato/ui/backend/record-locking` imports in core modules touched by this spec.

## Data & Settings

- Record lock settings default now explicitly enable all resources:
  - `enabledResources: ['*']`
- Wildcard/prefix evaluation:
  - `'*'` => all resources enabled
  - `'module.*'` => prefix match
  - exact resource match still supported
- Tenant setup backfills empty `enabledResources` on existing settings rows.

## API/UI Integration Coverage

### API paths

- `PUT/DELETE` CRUD mutations through `makeCrudRoute` (all modules using factory).
- `POST /api/sales/quotes/convert`
- `POST /api/sales/quotes/send`
- Existing enterprise lock API remains:
  - `/api/record_locks/acquire`
  - `/api/record_locks/release`
  - `/api/record_locks/heartbeat`
  - `/api/record_locks/force-release`

### UI paths (core pages touched)

- `/backend/customers/deals/[id]`
- `/backend/customers/companies/[id]`
- `/backend/customers/people/[id]` (via highlights component)
- `/backend/sales/documents/[id]`

## Integration Contracts for Test Authoring

### API contract assertions

| Path | Method | Required inputs | Expected statuses | Required assertions |
|------|--------|-----------------|-------------------|---------------------|
| `/api/record_locks/acquire` | `POST` | auth session; `entityType`, `recordId`; optional lock headers | `200` | `ok=true` with lock token on owner acquire; `acquired=false` with lock payload on competing acquire |
| `/api/record_locks/release` | `POST` | auth session; current lock token; `entityType`, `recordId`, `reason` | `200` | `released=true`; when `reason=conflict_resolved`, assert `conflictResolved=true` |
| `/api/record_locks/heartbeat` | `POST` | auth session; current lock token; `entityType`, `recordId` | `200` | lock stays active and ownership remains unchanged |
| `/api/record_locks/force-release` | `POST` | admin/superadmin auth session; `entityType`, `recordId` | `200` | `released=true`; lock status transitions to `force_released`; owner receives notification |
| CRUD `PUT/DELETE` via `makeCrudRoute` | `PUT/DELETE` | auth session; mutation payload; if lock owned then lock token | `200`, `409`, `423` | `423 code=record_locked` while another lock is active in pessimistic mode; `409 code=record_lock_conflict` in optimistic conflict |
| `/api/sales/quotes/convert` | `POST` | auth session; quote id; lock headers when required | `200`, `409`, `423` | same guard behavior as CRUD routes |
| `/api/sales/quotes/send` | `POST` | auth session; quote id; lock headers when required | `200`, `409`, `423` | same guard behavior as CRUD routes |

### UI flow assertions

| Path | Role | Flow | Required assertions |
|------|------|------|---------------------|
| `/backend/customers/companies/[id]` | admin/employee | open record, edit while lock active by another user | pessimistic: form mutation blocked with `423`; optimistic: save attempt returns `409` conflict |
| `/backend/customers/deals/[id]` | admin/employee | edit with guard-backed update | generic guard errors only; no direct record-lock component dependency |
| `/backend/customers/people/[id]` | admin/employee | edit via highlights/details | generic guard errors only; no direct record-lock component dependency |
| `/backend/sales/documents/[id]` | admin/employee | guarded document mutation | guard errors propagated (`409/423`) and mutation succeeds after release/resolve |

### Integration test matrix (authoritative)

| Test ID | Priority | Type | Prerequisite role(s) | Coverage intent |
|---------|----------|------|----------------------|-----------------|
| `TC-LOCK-001` | High | API | employee + employee | Pessimistic second editor receives `423`, then succeeds after owner release |
| `TC-LOCK-002` | High | API | employee + employee | Optimistic conflict resolved with `accept_incoming` via release contract |
| `TC-LOCK-003` | High | API | employee + employee | Optimistic conflict resolved with `accept_mine`; resolution notification emitted |
| `TC-LOCK-004` | High | API | employee + employee | Optimistic conflict resolved with `merged`; merged payload persists |
| `TC-LOCK-005` | High | API | employee + admin | Admin force-release unblocks guarded mutation and emits force-release notification |
| `TC-LOCK-006` | Medium | API | employee + employee | Competing acquire payload exposes lock owner identity and IP for viewer banner |
| `TC-LOCK-007` | Medium | API/UI-notification | employee + employee | Conflict notification includes changed fields and action buttons (`accept_incoming`, `accept_mine`) |

### Fixture and isolation requirements

- Each integration test MUST create its own people/company fixtures via API before acquiring locks.
- Each integration test MUST create independent users/sessions per actor; do not reuse global seeded actors as behavioral preconditions.
- Each integration test MUST set lock strategy explicitly (`optimistic`/`pessimistic`) through settings API before assertions.
- Tests MUST NOT hardcode entity IDs or conflict IDs; resolve from fixture creation or prior API responses.
- Tests MUST release active locks in `finally` blocks and delete created fixtures to keep runs deterministic.

### Risk-to-test mapping

| Risk | Required test coverage |
|------|------------------------|
| Conflict UX drift after decoupling core lock UI | `TC-LOCK-002`, `TC-LOCK-003`, `TC-LOCK-004`, `TC-LOCK-007` |
| Custom mutation routes missing guard | Guard assertions on `/api/sales/quotes/convert` and `/api/sales/quotes/send` with `409/423` expectations |
| Existing tenants not backfilled to wildcard resources | Integration setup path validates lock settings normalize to `enabledResources=['*']` before lock assertions |

## Risks & Mitigations

- Risk: behavior drift on conflict UX after removing lock dialogs from core pages.
  - Mitigation: keep backend guard responses stable (`409/423` payloads) and generic flash flows.
- Risk: custom mutation routes missing guard.
  - Mitigation: migrated key sales custom routes and codified generic guard utility for future routes.
- Risk: existing tenants with empty resource lists remain partially configured.
  - Mitigation: setup backfill to wildcard on tenant init path.

## Phasing

1. Shared contract + CRUD factory integration.
2. Enterprise adapter + DI registration.
3. Core route migration for non-CRUD endpoints.
4. Core page lock-UI decoupling.
5. Defaults/wildcard config rollout.

## Final Compliance Review

- Module isolation: improved (enterprise logic behind extensibility point).
- No cross-module ORM relation changes.
- Tenant scoping retained.
- Validation and conflict handling remain server-enforced.

## Changelog

- 2026-02-20: Initial spec for enterprise-only record-lock extensibility and all-entity default enablement.
- 2026-02-20: Added integration-authoring contract details (status codes, fixture rules, test matrix, and risk-to-test mapping).
