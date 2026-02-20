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
