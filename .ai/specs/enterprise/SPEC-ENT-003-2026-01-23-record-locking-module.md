# SPEC-ENT-003: Enterprise Record Locking Module

- Date: 2026-01-23
- Status: Implemented (rewritten for implementation parity on 2026-02-22)
- Scope: Enterprise
- Package: `packages/enterprise/src/modules/record_locks/`

## TLDR

**Key Points:**
- Enterprise record locking provides optimistic and pessimistic mutation protection with participant presence, conflict detection/resolution, force release, and notification/event integration.
- The module prevents unsafe concurrent edits for tenant- and organization-scoped records through a dedicated service, HTTP API, UI injection widget, and a generic mutation guard adapter.

**Scope:**
- Server APIs under `/api/record_locks/*` for lock lifecycle management
- `RecordLockService` with dual-strategy conflict logic based on audit action logs
- UI injection widget mounted into backend record, mutation, and CRUD form spots
- Integration with the shared generic mutation guard contract (`crudMutationGuardService`) documented in `SPEC-035`
- 10 typed module events and 8 notification types with persistent subscribers
- Command pattern support for conflict resolution (`accept_incoming`, `accept_mine`)

## Overview

The module prevents unsafe concurrent edits for tenant- and organization-scoped records.

It supports:
- **Pessimistic mode**: block competing edits (`423 record_locked`)
- **Optimistic mode**: allow parallel editing and detect stale-base conflicts (`409 record_lock_conflict`)
- **Participant ring**: multiple active participants on a resource with presence tracking
- **Conflict resolution**: `accept_incoming`, `accept_mine`, `merged` (server supports all three; UI currently exposes `accept_incoming` and `accept_mine`)
- **Conflict and participation notifications** through module events, persistent subscribers, and in-app notification renderers
- **Background cleanup** of expired locks and stale conflicts with configurable retention

## Problem Statement

Without record-level mutation coordination:
- Users overwrite each other silently in optimistic workflows
- Critical records cannot be safely protected in high-contention contexts
- Admins have no controlled takeover mechanism during abandoned sessions
- Teams lack user-visible collaboration signals (active participants, incoming changes)
- Deleted records leave stale lock holders with no awareness of the deletion

## Proposed Solution

Use a dedicated enterprise module with four layers:
1. **Core lock/conflict service** (`RecordLockService`) with lock lifecycle, conflict reasoning, and background cleanup.
2. **HTTP API endpoints** for acquire/validate/heartbeat/release/force-release/settings.
3. **UI widget injection** for lock state banners, conflict dialog, participant presence, and save-header propagation.
4. **Generic mutation guard adapter** registered as `crudMutationGuardService` to apply the same checks in CRUD and custom mutation routes.

The generic mutation guard contract itself is framework-level (OSS) and documented in `.ai/specs/SPEC-035-2026-02-22-mutation-guard-mechanism.md`. This spec documents the enterprise adapter implementation.

## Architecture

### Module Surfaces

| File | Purpose |
|------|---------|
| `index.ts` | Module metadata, imports `commands/conflicts` initialization |
| `di.ts` | DI registration: `recordLockService`, `crudMutationGuardService` |
| `acl.ts` | Feature declarations |
| `setup.ts` | Tenant initialization + default role mapping |
| `events.ts` | 10 typed event declarations via `createModuleEvents` |
| `notifications.ts` | 8 server-side notification type definitions |
| `notifications.client.ts` | Client-side notification renderers (custom `IncomingChangesRenderer`) |
| `commands/conflicts.ts` | Command pattern: `record_locks.conflict.accept_incoming`, `record_locks.conflict.accept_mine` |
| `api/*` | HTTP API routes (6 endpoints) |
| `widgets/injection/*` | Widget injection with `onBeforeSave`/`onAfterSave` hooks |
| `widgets/injection-table.ts` | Spot-to-widget mapping |
| `widgets/notifications/IncomingChangesRenderer.tsx` | Custom notification renderer |
| `backend/settings/record-locks/page.tsx` | Settings management UI |
| `data/entities.ts` | MikroORM entities: `RecordLock`, `RecordLockConflict` |
| `data/validators.ts` | Zod validation schemas for API inputs and responses |
| `lib/config.ts` | Settings schema, defaults, resource enablement logic |
| `lib/recordLockService.ts` | Core business logic (~1915 lines) |
| `lib/crudMutationGuardService.ts` | Mutation guard adapter |
| `lib/clientLockStore.ts` | Client-side in-memory state management |
| `lib/notificationHelpers.ts` | Resource link resolution, notification utilities |
| `subscribers/*.ts` | 8 persistent event subscribers |
| `i18n/*.json` | Translations (en, de, es, pl — 76 keys each) |

### ACL Features

| Feature ID | Description | Default Roles |
|------------|-------------|---------------|
| `record_locks.view` | View and use record locking | superadmin, admin, employee |
| `record_locks.manage` | Manage record locking settings | superadmin, admin |
| `record_locks.force_release` | Force release locks owned by other users | superadmin, admin |
| `record_locks.override_incoming` | Override incoming conflict changes | superadmin, admin |

### Settings Resolution

`RecordLockService.getSettings()` reads module config (`record_locks/settings` via `ModuleConfigService`) and normalizes values through `normalizeRecordLockSettings()`.

**Defaults** (defined in `lib/config.ts`):
- `enabled: true`
- `strategy: 'optimistic'`
- `timeoutSeconds: 300`
- `heartbeatSeconds: 30`
- `enabledResources: ['*']`
- `allowForceUnlock: true`
- `allowIncomingOverride: true`
- `notifyOnConflict: true`

**Resource enablement logic** (`isRecordLockingEnabledForResource`):
- Disabled globally → no locking
- Empty `enabledResources` → all resources enabled
- `'*'` → all resources enabled
- `'module.*'` → prefix match (e.g., `'customers.*'` matches `'customers.person'`)
- Exact resource match supported

**Persistence**: Settings stored in `ModuleConfig` entity with `moduleId: 'record_locks'`, `name: 'settings'`.

**Tenant initialization** (`setup.ts`): `onTenantCreated` hook creates default settings if none exist, or merges `enabledResources` into existing empty config.

### Lock Lifecycle

#### Acquire

`POST /api/record_locks/acquire` calls `recordLockService.acquire`:

1. Schedules background cleanup if threshold exceeded
2. Checks if locking enabled for resource; returns `ok: true`, `resourceEnabled: false` if disabled
3. Finds all non-expired active locks for the resource (auto-marks expired locks, emits `participant.left` for each)
4. **Pessimistic contention**: if competing lock from different user, emits `record_locks.lock.contended` (throttled) and returns `423 record_locked`
5. **Re-acquire**: same user refreshes heartbeat/expiry, returns `acquired: false`
6. **New lock**: creates lock row with unique UUID token and `baseActionLogId` from latest action log
7. Handles unique constraint collisions (race condition: user acquires own lock again, or pessimistic contention detected)

**Post-acquisition events** (only if new lock created):
- `record_locks.lock.acquired` with active participant count
- `record_locks.participant.joined` to other participants (suppressed if same user re-joins within 20s of a `'saved'` release — `PARTICIPANT_REJOIN_AFTER_SAVE_SUPPRESS_MS`)

#### Heartbeat

`POST /api/record_locks/heartbeat`:
- Refreshes `lastHeartbeatAt` and `expiresAt`
- If lock expired, marks status `'expired'`
- Returns `{ ok: true, expiresAt }` or `{ ok: true, expiresAt: null }` if expired

#### Release

`POST /api/record_locks/release`:

**Release reasons** (allowed via API): `'saved'`, `'cancelled'`, `'unmount'`, `'conflict_resolved'`

**Flow:**
1. Check resource enabled
2. If `reason === 'conflict_resolved'` with `conflictId` and `resolution === 'accept_incoming'`: resolve conflict first
3. Find lock by token (if provided) or by user ownership
4. Mark released with status/reason/`releasedByUserId`/timestamp
5. Emit `record_locks.lock.released`
6. If `releaseReason === 'unmount'`: emit `record_locks.participant.left` to remaining active participants with count

#### Force Release

`POST /api/record_locks/force-release`:

- Requires feature `record_locks.force_release`
- Gated by setting `allowForceUnlock`
- Finds all active locks, sorts by join order (`lockedAt`, then `createdAt`, then `id`)
- Releases oldest lock (queue head) with status `'force_released'`, reason `'force'`
- Emits `record_locks.lock.force_released` with optional reason string
- Returns next-in-queue lock (if any) or `null`
- Route returns `409 record_force_release_unavailable` when nothing releasable

### Mutation Validation Logic

`recordLockService.validateMutation` powers API preflight (`/api/record_locks/validate`) and the generic guard adapter.

#### Pessimistic

- Competing lock without ownership → `423 record_locked`
- Owned lock with mismatched token → `423 record_locked`
- Otherwise success with `shouldReleaseOnSuccess = true` if owned lock

#### Optimistic

1. Parse mutation headers (baseLogId, resolution, conflictId)
2. **Existing conflict check**: if `conflictId` provided and pending conflict exists:
   - If user is conflict actor and provides `accept_mine`/`merged` with override permission → auto-resolve, return success
   - If already resolved by same user with same resolution → allow
   - Otherwise → return `409 record_lock_conflict` with conflict payload
3. **New conflict detection** via action log comparison:
   - `hasConflictingBaseLog`: latest action log ID differs from provided `baseLogId`
   - `hasConflictingWriteAfterLockStart`: write from different user after lock started, no `baseLogId` provided
   - Combined: `isConflictingWrite = hasConflictingBaseLog || hasConflictingWriteAfterLockStart`
4. On conflict:
   - If user provides `accept_mine`/`merged` and can override → auto-resolve, return success
   - Otherwise → create conflict (with advisory lock deduplication), return `409 record_lock_conflict`

**Conflict payload includes:**
- Conflict id, resource ids, base/incoming action log ids
- `allowIncomingOverride` (from settings)
- `canOverrideIncoming` (settings + RBAC `record_locks.override_incoming`)
- `resolutionOptions`: `['accept_mine']` when user can override, otherwise empty
- Field-level changes (up to 25), built from `changesJson` and/or snapshot diffs

**Ignored metadata fields** in conflict diff: `updatedAt`, `createdAt`, `deletedAt` (plus 3 others in `SKIPPED_CONFLICT_FIELDS` set).

### Resolution Paths

- **`accept_incoming`**:
  - Via release endpoint: `reason='conflict_resolved'`, `conflictId`, `resolution='accept_incoming'`
  - Via command: `record_locks.conflict.accept_incoming` (input: `{ id }`)
- **`accept_mine`**:
  - Via mutation validation header: `x-om-record-lock-resolution: accept_mine`
  - Via command: `record_locks.conflict.accept_mine` (input: `{ id }`)
  - Requires: `allowIncomingOverride` setting AND `record_locks.override_incoming` RBAC feature
- **`merged`**:
  - Via mutation validation header: `x-om-record-lock-resolution: merged`
  - Same authorization as `accept_mine`

Conflict resolution updates conflict row (`status → resolved_*`, `resolution`, `resolvedByUserId`, `resolvedAt`) and emits `record_locks.conflict.resolved`.

### Generic Mutation Guard Integration

**Adapter**: `packages/enterprise/src/modules/record_locks/lib/crudMutationGuardService.ts`

Registered as DI token `crudMutationGuardService` via factory `createRecordLockCrudMutationGuardService(recordLockService)`.

**`validateMutation`**:
- Reads record lock headers from request via `readRecordLockHeaders(input.requestHeaders)`
- Maps operation (`'delete'` → `'DELETE'`, else → `'PUT'`) and delegates to `recordLockService.validateMutation`
- Returns validation result; `shouldRunAfterSuccess = result.resourceEnabled`

**`afterMutationSuccess`**:
- Always runs for resource-enabled routes and does (in order):
  1. `emitIncomingChangesNotificationAfterMutation` (PUT operations only, gated by `notifyOnConflict` setting)
  2. `emitRecordDeletedNotificationAfterMutation` (DELETE operations only)
  3. `releaseAfterMutation(... reason: 'saved')`

**Incoming changes notification** (`emitIncomingChangesNotificationAfterMutation`):
- Discovers recipients: active lock participants (excluding mutator), with fallback to recent locks within timeout window
- Extracts changed field names from latest action log (`changesJson` or snapshots, limit 12)
- Builds change rows (`{ field, incoming, current }`, limit 12) from `changesJson`
- Emits `record_locks.incoming_changes.available`

**Record deleted notification** (`emitRecordDeletedNotificationAfterMutation`):
- Same recipient discovery as incoming changes
- Emits `record_locks.record.deleted` with `deletedByUserId` and `recipientUserIds`

**Current non-CRUD custom routes wired to shared guard:**
- `POST /api/sales/quotes/convert` (`resourceKind: 'sales.quote'`, `operation: 'update'`)
- `POST /api/sales/quotes/send` (`resourceKind: 'sales.quote'`, `operation: 'update'`)

See `SPEC-035` for the generic guard contract, CRUD factory integration, and fail-safe behavior.

### Events

10 typed events declared via `createModuleEvents` in `events.ts`:

| Event ID | Label | Entity | Category |
|----------|-------|--------|----------|
| `record_locks.lock.acquired` | Record Lock Acquired | lock | crud |
| `record_locks.participant.joined` | Record Lock Participant Joined | lock | lifecycle |
| `record_locks.participant.left` | Record Lock Participant Left | lock | lifecycle |
| `record_locks.lock.contended` | Record Lock Contended | lock | lifecycle |
| `record_locks.lock.released` | Record Lock Released | lock | crud |
| `record_locks.lock.force_released` | Record Lock Force Released | lock | crud |
| `record_locks.record.deleted` | Locked Record Deleted | record | crud |
| `record_locks.conflict.detected` | Record Lock Conflict Detected | conflict | crud |
| `record_locks.conflict.resolved` | Record Lock Conflict Resolved | conflict | crud |
| `record_locks.incoming_changes.available` | Incoming Changes Available | change | lifecycle |

Exports: `emitRecordLocksEvent` function and `RecordLocksEventId` type.

### Notifications and Subscribers

#### Notification Types

8 notification types defined in `notifications.ts`:

| Type | Icon | Severity | Expiry |
|------|------|----------|--------|
| `record_locks.participant.joined` | `users` | info | 24h |
| `record_locks.participant.left` | `user-minus` | info | 24h |
| `record_locks.lock.contended` | `users` | warning | 48h |
| `record_locks.lock.force_released` | `unlock` | warning | 48h |
| `record_locks.record.deleted` | `trash-2` | warning | 48h |
| `record_locks.conflict.detected` | `git-compare-arrows` | warning | 48h |
| `record_locks.incoming_changes.available` | `git-pull-request-arrow` | info | 48h |
| `record_locks.conflict.resolved` | `check-circle` | info | 48h |

All types define `actions: []` (no actionable notification buttons).

`notifications.client.ts` wraps server types and injects custom `IncomingChangesRenderer` for `record_locks.incoming_changes.available` (renders a field-level change table with columns: Field, Incoming, Current).

#### Subscribers

All subscribers are persistent (`persistent: true`) and map events to in-app notifications:

| Subscriber ID | Event | Recipients | Special Logic |
|---------------|-------|------------|---------------|
| `record_locks:participant-joined-notification` | `participant.joined` | Other participants (excludes joiner) | Group key: `{lockId}:{joinedUserId}` |
| `record_locks:participant-left-notification` | `participant.left` | Remaining participants (excludes leaver) | Group key: `{lockId}:{leftUserId}` |
| `record_locks:lock-contended-notification` | `lock.contended` | Lock owner only | Skips self-contention |
| `record_locks:lock-force-released-notification` | `lock.force_released` | Original lock holder | Skips self-release |
| `record_locks:record-deleted-notification` | `record.deleted` | Other participants (excludes deleter) | `sourceEntityType: 'record_locks:record'` |
| `record_locks:conflict-detected-notification` | `conflict.detected` | Conflict actor | Checks `isConflictNotificationEnabled()` gate; extracts changed fields from action log (limit 12) |
| `record_locks:conflict-resolved-notification` | `conflict.resolved` | Incoming actor | Checks `isConflictNotificationEnabled()` gate; defaults resolution to `'accept_mine'` if null |
| `record_locks:incoming-changes-notification` | `incoming_changes.available` | All lock participants (including incoming actor) | Passes `changedRowsJson` string; group key: `{incomingActionLogId}` fallback `{resourceKind}:{resourceId}` |

### UI Integration

#### Injection Table

| Spot ID | Priority | Kind |
|---------|----------|------|
| `backend:record:current` | 600 | stack |
| `backend-mutation:global` | 500 | stack |
| `crud-form:*` | 400 | stack |

Widget ID: `record_locks.injection.crud-form-locking`

#### Widget Server Config (`widget.ts`)

Metadata:
- `id: 'record_locks.injection.crud-form-locking'`
- `features: ['record_locks.view']`
- `priority: 400`

Event handlers:
- **`onBeforeSave(data, context)`**: Validates lock state (checks for `recordDeleted`, unresolved conflict, calls `validateBeforeSave()`), returns request headers with lock metadata
- **`onAfterSave(data, context)`**: Clears lock form state

#### Widget Client Component (`widget.client.tsx` — ~1393 lines)

**Multi-instance coordination**: Multiple widget instances on the same page are coordinated via a global owner map (`__openMercatoRecordLockWidgetOwners__`). Higher priority instances (formId-based = priority 2 > context-based = priority 1) claim ownership. Non-primary instances release locks and clear state. Ownership changes broadcast via `om:record-lock-owner-changed` custom event.

**Lifecycle effects:**
1. Lock acquisition on mount via `POST /api/record_locks/acquire`
2. Heartbeat polling every 10 seconds via `POST /api/record_locks/heartbeat`
3. Presence refresh every 4 seconds via re-acquire (updates participant count, latest action log ID)
4. Lock contention banner via unread notification polling
5. Incoming changes sync triggered by `showIncomingChanges=1` query parameter
6. Mutation error handling: listens to `BACKEND_MUTATION_ERROR_EVENT` and `om:crud-save-error`, extracts conflict payload, opens conflict dialog
7. Lock release on unmount: `navigator.sendBeacon()` on `pagehide` event, async release fallback on component unmount (both with `reason: 'unmount'`)

**User actions:**
- **Take over**: force-release + re-acquire
- **Accept incoming**: validate → release with `resolution: 'accept_incoming'` + `conflictId` → reload page
- **Keep mine**: validate → set `pendingResolution: 'accept_mine'`, `pendingResolutionArmed: true` → retry mutation (next save includes resolution header)
- **Keep editing**: close dialog without resolution

**Mutation header propagation** (set by `onBeforeSave`):
- `x-om-record-lock-kind` — resource kind
- `x-om-record-lock-resource-id` — record UUID
- `x-om-record-lock-token` — lock ownership token
- `x-om-record-lock-base-log-id` — latest action log ID for conflict detection
- `x-om-record-lock-resolution` — `'normal'`, `'accept_mine'`, or `'merged'` (when armed)
- `x-om-record-lock-conflict-id` — conflict UUID (when resolving)

Headers are scoped via `withScopedApiRequestHeaders()` from `@open-mercato/ui/backend/utils/apiCall` and propagated through `apiCall` to server-side routes.

#### Settings Page

- Path: `/backend/settings/record-locks`
- Feature gate: `record_locks.manage`
- Fields: enable toggle, strategy dropdown, timeout (30-3600s), heartbeat (5-300s), enabled resources (tags input with entity registry suggestions), force unlock toggle, incoming override toggle, notify on conflict toggle
- Reads/writes via `GET/POST /api/record_locks/settings`

### Consumer Pages Using `useGuardedMutation`

Backend detail pages wrap mutations through the `useGuardedMutation` hook:

| Page | Context ID Pattern | Resource Kind |
|------|--------------------|---------------|
| `/backend/customers/people/[id]` | `customer-person:{id}` | `customers.person` |
| `/backend/customers/companies/[id]` | `customer-company:{id}` | `customers.company` |
| `/backend/sales/documents/[id]` | (document-specific) | `sales.quote` / `sales.order` |

### Throttling and Deduplication

| Mechanism | Key Pattern | TTL/Interval |
|-----------|-------------|--------------|
| Lock contention event throttle | `tenantId\|orgId\|resourceKind\|resourceId\|lockedByUserId\|attemptedByUserId` | 15s |
| Participant rejoin suppression | Checks recent `'saved'` release within window | 20s |
| Conflict advisory lock deduplication | `record_locks:conflict:tenantId:orgId:resourceKind:resourceId:actorUserId:baseLogId:incomingLogId` | Transaction-scoped |
| Background cleanup scheduling | Per-tenant debounce | 5 min minimum |

### Background Cleanup

`cleanupHistoricalRecords()` runs on a per-tenant debounced schedule (minimum 5 min between runs):

| Record Type | Retention | Condition |
|-------------|-----------|-----------|
| Released/expired/force-released locks | 3 days | Status is not `'active'` |
| Resolved conflicts | 7 days | Status starts with `'resolved_'` |
| Pending conflicts | 1 day | Status is `'pending'` |

## Data Models

### `record_locks`

Table: `record_locks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `resource_kind` | text | Resource type identifier |
| `resource_id` | text | Resource UUID |
| `token` | text, unique | Lock ownership token |
| `strategy` | enum | `'optimistic'` / `'pessimistic'`, default `'optimistic'` |
| `status` | enum | `'active'` / `'released'` / `'expired'` / `'force_released'`, default `'active'` |
| `locked_by_user_id` | UUID, FK | Lock holder |
| `locked_by_ip` | text, nullable | Client IP |
| `base_action_log_id` | UUID, FK, nullable | Action log at lock time |
| `locked_at` | timestamp | Acquisition time |
| `last_heartbeat_at` | timestamp | Last heartbeat |
| `expires_at` | timestamp | Lock expiration |
| `released_at` | timestamp, nullable | Release time |
| `released_by_user_id` | UUID, FK, nullable | Releasing user |
| `release_reason` | text, nullable | `'saved'` / `'cancelled'` / `'unmount'` / `'expired'` / `'force'` / `'conflict_resolved'` |
| `tenant_id` | UUID, FK | Tenant scoping |
| `organization_id` | UUID, FK, nullable | Organization scoping |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp, nullable | Soft delete |

**Indexes:**
- `record_locks_resource_status_idx`: `(tenant_id, resource_kind, resource_id, status)`
- `record_locks_owner_status_idx`: `(tenant_id, locked_by_user_id, status)`
- `record_locks_expiry_status_idx`: `(tenant_id, expires_at, status)`
- `record_locks_active_scope_user_org_unique`: partial unique on `(resource_kind, resource_id, locked_by_user_id, organization_id)` where active
- `record_locks_active_scope_user_tenant_unique`: partial unique on `(resource_kind, resource_id, locked_by_user_id, tenant_id)` where active

### `record_lock_conflicts`

Table: `record_lock_conflicts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `resource_kind` | text | |
| `resource_id` | text | |
| `status` | enum | `'pending'` / `'resolved_accept_incoming'` / `'resolved_accept_mine'` / `'resolved_merged'` |
| `resolution` | enum, nullable | `'accept_incoming'` / `'accept_mine'` / `'merged'` |
| `base_action_log_id` | UUID, FK, nullable | Base state action log |
| `incoming_action_log_id` | UUID, FK, nullable | Incoming change action log |
| `conflict_actor_user_id` | UUID, FK | User attempting to save |
| `incoming_actor_user_id` | UUID, FK, nullable | User who made incoming change |
| `resolved_by_user_id` | UUID, FK, nullable | |
| `resolved_at` | timestamp, nullable | |
| `tenant_id` | UUID, FK | |
| `organization_id` | UUID, FK, nullable | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp, nullable | |

**Indexes:**
- `record_lock_conflicts_resource_idx`: `(tenant_id, resource_kind, resource_id, status, created_at)`
- `record_lock_conflicts_users_idx`: `(tenant_id, conflict_actor_user_id, incoming_actor_user_id, created_at)`

### Module Settings (`ModuleConfig`)

Stored under `moduleId: 'record_locks'`, `name: 'settings'`:

| Field | Type | Default |
|-------|------|---------|
| `enabled` | boolean | `true` |
| `strategy` | `'optimistic'` / `'pessimistic'` | `'optimistic'` |
| `timeoutSeconds` | number (30-3600) | `300` |
| `heartbeatSeconds` | number (5-300) | `30` |
| `enabledResources` | string[] | `['*']` |
| `allowForceUnlock` | boolean | `true` |
| `allowIncomingOverride` | boolean | `true` |
| `notifyOnConflict` | boolean | `true` |

## API Contracts

### Endpoints

| Endpoint | Method | Feature Gate | Notes |
|----------|--------|--------------|-------|
| `/api/record_locks/acquire` | POST | `record_locks.view` | Acquire or join lock queue/presence |
| `/api/record_locks/heartbeat` | POST | `record_locks.view` | Refresh active lock |
| `/api/record_locks/release` | POST | `record_locks.view` | Release lock or resolve conflict (`accept_incoming`) |
| `/api/record_locks/force-release` | POST | `record_locks.force_release` | Force release active owner lock |
| `/api/record_locks/validate` | POST | `record_locks.view` | Preflight mutation validation |
| `/api/record_locks/settings` | GET | `record_locks.manage` | Read module settings |
| `/api/record_locks/settings` | POST | `record_locks.manage` | Update module settings |

### Mutation Header Contract

Used by guarded mutations (set by widget `onBeforeSave`, read by service `readRecordLockHeaders`):

| Header | Required | Values |
|--------|----------|--------|
| `x-om-record-lock-kind` | yes | Resource kind string |
| `x-om-record-lock-resource-id` | yes | Resource UUID |
| `x-om-record-lock-token` | no | Lock ownership token |
| `x-om-record-lock-base-log-id` | no | Action log UUID for conflict baseline |
| `x-om-record-lock-resolution` | no | `'normal'` / `'accept_mine'` / `'merged'` |
| `x-om-record-lock-conflict-id` | no | Conflict UUID being resolved |

### Error/Result Codes

| Scenario | HTTP Status | Code |
|----------|-------------|------|
| Lock contention (pessimistic) | `423` | `record_locked` |
| Optimistic conflict | `409` | `record_lock_conflict` |
| Force release unavailable | `409` | `record_force_release_unavailable` |

### PII Redaction Behavior

Acquire and validate routes redact personally identifying lock-owner details:
- `lockedByIp`: set to `null`
- `lockedByName`: removed entirely
- `lockedByEmail`: masked to `xx**@yyyy**.<domain>` format (first 2 chars of local part, first 4 chars of domain part)
- Participant IPs, names, and emails: same redaction applied

Force release capability checked via `rbacService.userHasAllFeatures(['record_locks.force_release'])` and included in acquire response as `allowForceUnlock`.

### Resource Link Resolution

`notificationHelpers.ts` maps resource kinds to backend edit page URLs:

| Resource Kind | URL Pattern |
|---------------|-------------|
| `catalog.product` | `/backend/catalog/products/{id}` |
| `catalog.product_variant` | `/backend/catalog/products/{id}` |
| `customers.person` | `/backend/customers/people/{id}` |
| `customers.company` | `/backend/customers/companies/{id}` |
| `customers.deal` | `/backend/customers/deals/{id}` |
| `sales.quote` | `/backend/sales/documents/{id}` |
| `sales.order` | `/backend/sales/documents/{id}` |

## Integration Coverage

### API Coverage

1. Acquire and competing access (`/acquire`) in optimistic/pessimistic strategies.
2. Heartbeat refresh and expiry handling (`/heartbeat`).
3. Release flows including conflict-resolved accept-incoming (`/release`).
4. Force release takeover behavior (`/force-release`).
5. Mutation preflight conflict payloads (`/validate`).
6. Settings read/write (`/settings`).
7. Guard propagation to CRUD writes (`PUT`/`DELETE` via `makeCrudRoute`) and custom sales mutation routes.

### Key UI Path Coverage

1. `/backend/settings/record-locks` — settings management.
2. `/backend/customers/people/[id]` — lock banner and conflict handling via `useGuardedMutation` + widget injection.
3. `/backend/customers/companies/[id]` — lock banner/conflict flow.
4. `/backend/sales/documents/[id]` — custom mutation lock validation path (convert, send).

### Automated Test Coverage

**Integration tests** (Playwright):
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-001.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-002.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-003.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-004.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-005.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-006.spec.ts`
- `packages/enterprise/src/modules/record_locks/__integration__/TC-LOCK-007.spec.ts`

**Unit/service tests**:
- `__tests__/config.test.ts` — configuration parsing and resource enablement
- `__tests__/recordLockService.test.ts` — lock acquisition, heartbeat, release, conflict logic
- `__tests__/crudMutationGuardService.test.ts` — mutation guard validation and after-success hooks
- `__tests__/recordLockWidgetHeaders.test.ts` — header extraction and validation

**API route tests**:
- `api/__tests__/acquire.route.test.ts`
- `api/__tests__/release.route.test.ts`
- `api/__tests__/settings.route.test.ts`

## Risks & Impact Review

#### Stale Lock Accumulation
- **Scenario**: Clients crash and never release locks.
- **Severity**: Medium
- **Affected area**: Lock contention and user experience
- **Mitigation**: Heartbeat expiry, unmount keepalive release (`navigator.sendBeacon`), background cleanup scheduling (5 min debounce), retention policy (3 days for released locks)
- **Residual risk**: Low-medium during prolonged network partitions

#### False Conflict Detection
- **Scenario**: Base log mismatch or sparse snapshots produce noisy conflicts.
- **Severity**: Medium
- **Affected area**: Optimistic save UX
- **Mitigation**: Multi-source diff strategy (`changesJson` + snapshots + payload), ignored metadata fields (`SKIPPED_CONFLICT_FIELDS`), deterministic conflict rows via advisory lock deduplication, conflict field limit (25)
- **Residual risk**: Medium for complex nested payloads

#### Unauthorized Keep-Mine Overrides
- **Scenario**: User tries to override incoming changes without permission.
- **Severity**: High
- **Affected area**: Data integrity in collaborative editing
- **Mitigation**: Dual gate (`allowIncomingOverride` setting + `record_locks.override_incoming` RBAC feature); both checked in `canUserOverrideIncoming()`
- **Residual risk**: Low

#### Notification Flood Under High Contention
- **Scenario**: Many join/contention/conflict events generate heavy notification volume.
- **Severity**: Medium
- **Affected area**: Notification channel noise and storage growth
- **Mitigation**: Contention event throttling (15s window), participant rejoin suppression (20s window), grouped notification keys, conflict notification toggle (`notifyOnConflict` setting), changed field limits (12 for notifications)
- **Residual risk**: Medium

#### Force Release Operational Misuse
- **Scenario**: Privileged users repeatedly take over active edits.
- **Severity**: Medium
- **Affected area**: Collaboration workflow trust
- **Mitigation**: Explicit feature gate (`record_locks.force_release`), settings gate (`allowForceUnlock`), event + notification audit trail, force-released user notified
- **Residual risk**: Medium

#### Pending Conflict Accumulation
- **Scenario**: Users trigger conflicts but never resolve them, accumulating `pending` rows.
- **Severity**: Low
- **Affected area**: Database storage growth
- **Mitigation**: Background cleanup with 1-day retention for pending conflicts
- **Residual risk**: Low

## Final Compliance Report — 2026-02-22

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` | No direct ORM relationships between modules | Compliant | Uses FK IDs (`locked_by_user_id`, `base_action_log_id`, etc.) without ORM relations |
| `AGENTS.md` | Always filter by `organization_id` for tenant-scoped entities | Compliant | Service builds scoped queries with `tenantId` and `organizationId`; scope fallback logic included |
| `AGENTS.md` | Validate all inputs with zod | Compliant | All route payloads validated in `data/validators.ts`; mutation headers validated via `recordLockMutationHeaderSchema` |
| `AGENTS.md` | Use DI (Awilix) to inject services | Compliant | `di.ts` registers `recordLockService` and `crudMutationGuardService` |
| `AGENTS.md` | Modules must remain isomorphic and independent | Compliant | Module uses events for cross-module communication; no direct imports of other module services |
| `AGENTS.md` | Event IDs: `module.entity.action` (singular entity, past tense) | Compliant | All 10 events follow convention |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | All 6 route files export `openApi` with feature gates |
| `packages/core/AGENTS.md` | Events: use `createModuleEvents()` with `as const` | Compliant | `events.ts` uses `createModuleEvents` |
| `packages/core/AGENTS.md` | Notifications: define types in `notifications.ts` | Compliant | 8 notification types declared |
| `packages/core/AGENTS.md` | Widget injection: declare in `widgets/injection/`, map via `injection-table.ts` | Compliant | Widget in `widgets/injection/record-locking/`, mapped in `injection-table.ts` |
| `packages/shared/AGENTS.md` | Shared MUST NOT include domain-specific logic | Compliant | Generic guard contract in shared; enterprise adapter in enterprise package |
| `.ai/specs/AGENTS.md` | Include required spec sections | Compliant | All required sections present |
| `AGENTS.md` | Spec must list integration coverage for affected API and key UI paths | Compliant | Explicit API and UI coverage sections provided |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Entity fields map to endpoint payloads; settings schema matches config |
| API contracts match architecture flows | Pass | Acquire/validate/release/force-release/heartbeat/settings logic aligned |
| Risks cover primary write operations | Pass | Lock lifecycle, conflict resolution, force-release, cleanup risks included |
| Event and notification mappings align with code | Pass | 10 events, 8 notification types, 8 subscribers all documented |
| Guard integration matches runtime behavior | Pass | Adapter + shared guard invocation documented; CRUD factory and custom routes covered |
| Subscriber behavior matches event payloads | Pass | All subscriber IDs, events, recipient logic, and gating documented |
| UI widget lifecycle matches client implementation | Pass | Mount/heartbeat/presence/release/conflict flows documented |
| Throttling and deduplication mechanisms documented | Pass | 4 mechanisms with keys and TTLs specified |

### Non-Compliant Items
- None.

### Verdict
Fully compliant. Approved.

## Changelog

### 2026-02-22
- Rewrote `SPEC-ENT-003` from scratch for parity with current implementation.
- Added comprehensive event table (10 events) with entity and category.
- Added notification types table (8 types) with icons, severity, and expiry.
- Added subscriber table (8 subscribers) with IDs, recipient logic, and gating.
- Added throttling/deduplication mechanisms table (4 mechanisms).
- Added background cleanup section with retention policies.
- Added consumer pages table showing `useGuardedMutation` usage.
- Added resource link resolution table for notification helpers.
- Added PII redaction behavior details (email masking format).
- Added multi-instance widget coordination via owner map.
- Documented all mutation header propagation through scoped header stack.
- Added pending conflict accumulation risk.
- Referenced `SPEC-035` for generic mutation guard contract.
- Expanded compliance matrix with additional AGENTS.md files reviewed.
- Expanded internal consistency check with subscriber, UI, and throttling verification.
