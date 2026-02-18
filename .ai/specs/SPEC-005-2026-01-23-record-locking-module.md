# SPEC-005: Record Locking Module

**Date:** 2026-01-23  
**Status:** Draft (Updated)  
**Module:** `record_locks` (`@open-mercato/core`)  
**Related:**
- [SPEC-017: Version History Panel](SPEC-017-2026-02-03-version-history-panel.md)
- [SPEC-020: Related Entity Version History](SPEC-020-2026-02-07-related-entity-version-history.md)

## TLDR
**Key points:**
- Record locking is introduced as a dedicated `record_locks` module with optimistic and pessimistic strategies.
- Conflict handling reuses existing snapshots from `action_logs` (from version-history work) and stores only references in lock conflicts.
- Lock enforcement is centralized in `makeCrudRoute` for `PUT`/`DELETE`, with a shared helper for custom mutation routes.
- UI integrates locking into `CrudForm` and custom detail pages already using `VersionHistoryAction`.
- Rollout is soft by default: `enabled=false` and `enabledResources=[]`.

**Scope:**
- New `record_locks` module (entities, service, API, ACL, setup, events, notifications).
- Shared CRUD enforcement + guarded mutation headers.
- UI hooks/components for lock lifecycle and conflict resolution.
- Adapter coverage for non-`CrudForm` edit surfaces.

## Overview
Concurrent edits currently rely on command/audit logs and optional undo/redo history, but there is no write-time lock contract. This spec introduces a reusable lock layer with two strategies:
- `pessimistic`: hard block if another editor owns the lock.
- `optimistic`: allow concurrent editing and detect conflict on save.

The design explicitly reuses `action_logs.snapshot_before` and `action_logs.snapshot_after` from existing version-history infrastructure. The lock module stores lightweight references (`action_log_id`) instead of duplicating full snapshots.

> **Market reference:** GitLab document locks and Figma-style conflict handling informed the split between hard-lock and conflict-resolution flows. We intentionally reject Git-style manual merge as default for all fields to keep MVP deterministic and UI-simple.

## Problem Statement
Without record-level locking:
- Users can overwrite each other silently during concurrent updates.
- The API has no universal mutation guard for shared CRUD routes.
- Custom edit pages (`sales documents`, `customer highlights`, `deals detail`) are inconsistent in concurrent-save behavior.
- Existing version snapshots in `action_logs` are not leveraged by conflict flows.

## Proposed Solution
Create `packages/core/src/modules/record_locks/` and integrate it into shared CRUD + UI:

1. Persist active locks in `record_locks`.
2. Persist conflict metadata in `record_lock_conflicts`, referencing `action_logs` rows for snapshot retrieval.
3. Add API for lock lifecycle (`acquire`, `heartbeat`, `release`, `force-release`) and module settings.
4. Enforce validation in `packages/shared/src/lib/crud/factory.ts` for `PUT`/`DELETE` when locking is enabled for resource.
5. Add UI primitives (`useRecordLock`, `RecordLockBanner`, `RecordConflictDialog`, `useRecordLockGuard`).
6. Emit events and notifications for forced unlock and conflict lifecycle.

### Design decisions
| Decision | Rationale |
|----------|-----------|
| Reuse `action_logs` snapshots | Avoid JSON duplication in lock tables, keep single source of truth for diffs/history |
| Soft rollout defaults (`enabled=false`) | Prevent behavior regressions after deploy |
| Enforcement in shared CRUD factory | Single guard point for all `makeCrudRoute` resources |
| Header-based mutation context | Keeps existing route signatures stable and works for both `CrudForm` and custom pages |
| Separate helper for custom routes | Covers mutation routes that bypass `makeCrudRoute` |

### Alternatives considered
| Alternative | Why rejected |
|-------------|--------------|
| Cherry-pick `origin/feat/017_version_history` into feature branch | Branch is stale vs `develop`; reverts current behavior like `includeRelated`/`parentResource*` |
| Store full `base/incoming/conflicting` snapshots in `record_lock_conflicts` | Duplicates heavy payload already in `action_logs`, increases migration/storage cost |
| Enforce only in UI | Unsafe; API would still allow blind overwrites |

## Architecture
### Module structure
`packages/core/src/modules/record_locks/`:
- `index.ts`, `acl.ts`, `setup.ts`, `di.ts`
- `events.ts`, `notifications.ts`
- `data/entities.ts`, `data/validators.ts`
- `lib/config.ts`, `lib/recordLockService.ts`
- `api/get/settings/route.ts`, `api/post/settings/route.ts`
- `api/post/acquire/route.ts`, `api/post/heartbeat/route.ts`, `api/post/release/route.ts`, `api/post/force-release/route.ts`
- `subscribers/*.ts`
- `i18n/*.json`

### Runtime flow
1. UI opens edit mode and calls `POST /api/record-locks/acquire`.
2. Backend validates scope (`tenant_id`, `organization_id`) and lock settings.
3. UI sends heartbeat (`POST /api/record-locks/heartbeat`) on interval.
4. Mutations (`PUT`/`DELETE`) include lock headers:
   - `x-om-record-lock-kind`
   - `x-om-record-lock-resource-id`
   - `x-om-record-lock-token`
   - `x-om-record-lock-base-log-id`
   - `x-om-record-lock-resolution`
   - `x-om-record-lock-conflict-id`
5. Shared CRUD factory calls `recordLockService.validateMutation(...)`.
6. Service returns:
   - `423` when pessimistic lock is held by another user.
   - `409` with `record_lock_conflict` payload for optimistic conflict.
7. UI opens conflict dialog and retries save with chosen resolution (`accept_mine` or `merged`).
8. On successful save, owner lock is released with reason `saved`.

### Event and notification flow
Emitted events:
- `record_locks.lock.acquired`
- `record_locks.lock.released`
- `record_locks.lock.force_released`
- `record_locks.conflict.detected`
- `record_locks.conflict.resolved`

Notification types:
- `record_locks.lock.force_released`
- `record_locks.conflict.detected`
- `record_locks.conflict.resolved`

Subscribers create notifications for affected actors (previous owner, conflicting editor, overwritten editor).

## Data Models
### `record_locks` (table)
Stores live lock ownership and lifecycle.

Required columns:
- `id` (uuid)
- `resource_kind` (text)
- `resource_id` (text)
- `token` (text, unique)
- `strategy` (`optimistic | pessimistic`)
- `status` (`active | released | expired | force_released`)
- `locked_by_user_id` (uuid)
- `locked_at`, `last_heartbeat_at`, `expires_at`
- `released_at`, `released_by_user_id`, `release_reason` (nullable)
- `tenant_id` (uuid), `organization_id` (uuid)
- `created_at`, `updated_at`, `deleted_at`

Indexes:
- `(tenant_id, resource_kind, resource_id, status)`
- `(tenant_id, locked_by_user_id, status)`
- `(tenant_id, expires_at, status)`

### `record_lock_conflicts` (table)
Stores conflict lifecycle and references to existing action logs.

Required columns:
- `id` (uuid)
- `resource_kind` (text)
- `resource_id` (text)
- `status` (`pending | resolved_accept_incoming | resolved_accept_mine | resolved_merged`)
- `resolution` (`accept_incoming | accept_mine | merged`, nullable until resolved)
- `base_action_log_id` (uuid FK-like reference to `action_logs.id`)
- `incoming_action_log_id` (uuid FK-like reference to `action_logs.id`)
- `conflict_actor_user_id` (uuid)
- `incoming_actor_user_id` (uuid)
- `resolved_by_user_id`, `resolved_at` (nullable)
- `tenant_id` (uuid), `organization_id` (uuid)
- `created_at`, `updated_at`, `deleted_at`

Snapshot strategy:
- Conflict payload for UI is assembled from `action_logs` referenced by `base_action_log_id` and `incoming_action_log_id`.
- No `base_snapshot` / `incoming_snapshot` JSON columns are persisted in `record_lock_conflicts`.

### Settings schema (`moduleConfigService`)
`moduleId: record_locks`, `name: settings`.

```ts
{
  enabled: false,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  enabledResources: [],
  allowForceUnlock: true,
  notifyOnConflict: true
}
```

## API Contracts
### New endpoints
1. `GET /api/record-locks/settings`
- Response `200`: `{ settings }`

2. `POST /api/record-locks/settings`
- Request: `{ enabled, strategy, timeoutSeconds, heartbeatSeconds, enabledResources, allowForceUnlock, notifyOnConflict }`
- Response `200`: `{ ok: true, settings }`

3. `POST /api/record-locks/acquire`
- Request: `{ resourceKind, resourceId }`
- Response `200`: `{ ok: true, lock: { token, strategy, ownerUserId, expiresAt, heartbeatSeconds } }`
- Errors:
  - `423`: lock held by another user in pessimistic mode

4. `POST /api/record-locks/heartbeat`
- Request: `{ token, resourceKind, resourceId }`
- Response `200`: `{ ok: true, expiresAt }`

5. `POST /api/record-locks/release`
- Request: `{ token, resourceKind, resourceId, reason?: 'saved' | 'cancelled' | 'unmount' }`
- Response `200`: `{ ok: true }`

6. `POST /api/record-locks/force-release`
- Request: `{ resourceKind, resourceId, reason?: string }`
- Response `200`: `{ ok: true }`
- Errors:
  - `403`: caller lacks force-unlock permission

### Shared CRUD behavior changes
`packages/shared/src/lib/crud/factory.ts`:
- For `PUT` and `DELETE`, parse lock headers and invoke `validateMutation(...)` when lock is enabled for `resourceKind`.
- Return codes:
  - `423` with `code='record_locked'` for pessimistic active lock owned by another user.
  - `409` with `code='record_lock_conflict'` and `conflict` payload for optimistic write conflict.
- On successful guarded mutation by lock owner, auto-release lock (`reason='saved'`).

### Helper for non-CRUD routes
Add shared helper for custom mutation routes so they can reuse the same validation and response shape.

### OpenAPI
All new route files export `openApi` docs and zod-based request/response schemas.

### Integration coverage matrix (required)
| ID | Path Type | Path | Scenario | Expected |
|----|-----------|------|----------|----------|
| LOCK-API-001 | API | `GET /api/record-locks/settings` | Settings read with tenant scope | `200` + settings payload |
| LOCK-API-002 | API | `POST /api/record-locks/settings` | Update strategy/resources | `200` persisted config |
| LOCK-API-003 | API | `POST /api/record-locks/acquire` | First editor acquires lock | `200` + token |
| LOCK-API-004 | API | `POST /api/record-locks/acquire` | Second editor in pessimistic mode | `423` blocked |
| LOCK-API-005 | API | `POST /api/record-locks/heartbeat` | Refresh active lock | `200` new expiry |
| LOCK-API-006 | API | `POST /api/record-locks/release` | Owner release | `200` |
| LOCK-API-007 | API | `POST /api/record-locks/force-release` | Admin force unlock | `200` + event/notification |
| LOCK-API-008 | API | `PUT /api/<crud-resource>` via `makeCrudRoute` | Pessimistic lock owned by other user | `423 record_locked` |
| LOCK-API-009 | API | `PUT /api/<crud-resource>` via `makeCrudRoute` | Optimistic conflict detected | `409 record_lock_conflict` |
| LOCK-API-010 | API | `DELETE /api/<crud-resource>` via `makeCrudRoute` | Guarded delete with valid lock | `200` + release |
| LOCK-UI-001 | UI | `CrudForm` edit flow | Acquire+heartbeat+release on success/unmount | lock lifecycle completed |
| LOCK-UI-002 | UI | `CrudForm` conflict flow | `409` opens conflict dialog | retry with resolution headers |
| LOCK-UI-003 | UI | `sales/documents/[id]` | `useRecordLockGuard` on custom mutation | same conflict flow as `CrudForm` |
| LOCK-UI-004 | UI | `customers PersonHighlights` | guarded mutation + lock banner | consistent status handling |
| LOCK-UI-005 | UI | `customers CompanyHighlights` | guarded mutation + lock banner | consistent status handling |
| LOCK-UI-006 | UI | `customers deals/[id]` | guarded mutation + conflict resolution | consistent resolution UX |

## Risks & Impact Review
#### Lock timeout drift
- **Scenario**: Heartbeat delays expire an active lock while user is editing.
- **Severity**: Medium
- **Affected area**: Active editors, UX reliability.
- **Mitigation**: `heartbeatSeconds` + grace checks on server; release reason tracks `expired`.
- **Residual risk**: Temporary false-expiry remains possible under heavy latency.

#### Conflict payload references missing action logs
- **Scenario**: Referenced `action_logs` entries are unavailable or soft-deleted.
- **Severity**: High
- **Affected area**: Conflict dialog rendering.
- **Mitigation**: Validate references at conflict creation; fallback payload with minimal metadata.
- **Residual risk**: Deep diff details may be partially unavailable for rare legacy records.

#### Shared CRUD regression
- **Scenario**: Lock validation breaks non-locked resources.
- **Severity**: High
- **Affected area**: All `makeCrudRoute` mutations.
- **Mitigation**: Guard logic only when module settings enable resource; targeted unit tests in `shared`.
- **Residual risk**: Misconfigured `enabledResources` can still disable intended protection.

#### Notification flood during edit contention
- **Scenario**: Repeated conflicts generate too many notifications.
- **Severity**: Medium
- **Affected area**: Notifications module UX/noise.
- **Mitigation**: Notify only on state transitions (`detected`, `resolved`, `force_released`), not every heartbeat/save retry.
- **Residual risk**: High-contention records can still produce frequent events.

#### Tenant isolation leak
- **Scenario**: Lock/conflict query returns data outside tenant/org scope.
- **Severity**: Critical
- **Affected area**: Security and compliance.
- **Mitigation**: Every query filters by `tenant_id` + `organization_id`; ACL checks on settings/force-release.
- **Residual risk**: None expected with mandatory scoped filters and tests.

## Final Compliance Report — 2026-02-17
### AGENTS.md Files Reviewed
- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | `record_lock_conflicts` references `action_logs` by ID only |
| `AGENTS.md` | Filter by `organization_id` for tenant-scoped entities | Compliant | All lock/conflict queries are scoped |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | Required on all new `record_locks` endpoints |
| `packages/core/AGENTS.md` | `setup.ts` must define defaultRoleFeatures for features | Compliant | Module setup includes role feature defaults |
| `packages/shared/AGENTS.md` | Shared package contains infra-only logic | Compliant | CRUD integration is generic, no domain coupling |
| `packages/ui/AGENTS.md` | Reuse `CrudForm` patterns and shared dialog UX | Compliant | Conflict flow integrated into `CrudForm` + reusable guard hook |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Endpoint payloads map to lock/conflict tables |
| API contracts match UI/UX section | Pass | Headers + conflict payload used by `CrudForm`/custom guard |
| Risks cover all write operations | Pass | Acquire/heartbeat/release/force-release/conflict paths covered |
| Commands/events cover all mutation side effects | Pass | Lock and conflict lifecycle events specified |
| Cache strategy covers read APIs | N/A | Module uses direct settings read; no dedicated cache layer in MVP |

### Non-Compliant Items
- None.

### Verdict
- **Fully compliant**: Approved — ready for implementation.

## Changelog
### 2026-02-17
- Rewrote SPEC-005 to current spec standard (TLDR, architecture, data/API contracts, risk register, compliance).
- Updated conflict model to reuse `action_logs` snapshots via `base_action_log_id` and `incoming_action_log_id` references.
- Added integration coverage matrix for API and UI flows.

### Review — 2026-02-17
- **Reviewer**: Codex Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A (no dedicated cache in MVP scope)
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved

### 2026-01-23
- Initial specification draft.
