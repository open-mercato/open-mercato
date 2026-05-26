# Push Notifications and Devices Modules

**Status:** Draft
**Date:** 2026-04-28
**Author:** Jacek Tomaszewski (`@jtomaszewski`)
**Related:** `packages/core/src/modules/notifications/` (in-app notifications, #412), `#539` (security/MFA — future device-trust consumer)

## TLDR

- Open Mercato currently ships only **in-app** notifications. There is no mobile push channel, no device-token registry, no DB-persistent notification type registry, and no per-channel user preferences.
- This spec proposes:
  - **Two new core modules**:
    - `@open-mercato/core/modules/devices` — generic per-tenant `(user, device, platform)` registry. Push is one consumer; MFA device trust (#539) and session-aware auth/audit logs are plausible future consumers.
    - `@open-mercato/core/modules/push_notifications` — push-token registry, mobile push delivery strategy, provider-pluggable sender (FCM + APNs reference providers), retry worker.
  - **A minimal extension to the existing `notifications` module**: a DB-backed notification type registry and a channel-agnostic preferences table. Designed so future channels (email/SMS) plug in without schema changes.
- The design is informed by a production implementation already running in a downstream app; ports are validated, not green-field. App-specific concerns (hard-coded categories, app i18n keys, deploy env wiring) are stripped before landing in core.
- Verified 2026-04-28 (`gh search`): no existing upstream issue/PR covers push, devices, preferences, or a persistent type registry.

**Out of scope:**
- Web push (browser Push API). Plausible follow-up.
- Email and SMS channels. Spec designs preferences/registry to accommodate them additively, but no implementation here.
- Notification categories, priority, `non_opt_out`, daily/weekly frequency caps. Deferred — Phase-1 governance is just "user can toggle a type off." Reintroduce as a later spec when an app hits a real need.
- Reworking the existing in-app `notifications` module's runtime — we extend it, we don't replace anything.

## Overview

Today, an Open Mercato app that wants to deliver mobile push must build the following itself:
1. A device-token store keyed by `(tenant, user, device)`.
2. A delivery strategy registered into the notifications module's strategy seam.
3. An FCM/APNs sender wrapper.
4. A type registry that mobile clients can read (so a settings screen can render the catalogue without a hard dependency on server source code).
5. Per-user, per-channel preference toggles.
6. A worker for retryable delivery with exponential backoff.

That is a lot of infrastructure — and it is the same in every app. This spec splits the work along channel-agnostic vs. channel-specific lines:

- **Channel-agnostic** (lives in existing `notifications` module): type registry, preferences. Future email/SMS modules read from the same tables.
- **Channel-specific** (lives in new `push_notifications` module): tokens, delivery rows, sender, worker, provider seam.
- **Cross-cutting** (new `devices` module): device identity, reusable beyond push.

## Problem Statement

### Gaps in the current `notifications` module

- `NotificationTypeDefinition` is **in-memory only**. A mobile app cannot enumerate types via API to render a preferences screen — it would have to ship a copy of the catalogue.
- No notion of **user preferences** per channel: `Notification.channels` is fixed at creation time; users cannot opt out per type.
- No **mobile push** delivery strategy.
- No **device registry**. There is no first-class `(user, device, platform)` entity, no `is_active` lifecycle, no platform metadata.

### Why a separate `devices` module

A device registry is useful beyond push:
- **MFA device trust** (#539) — "trusted device" lists.
- **Session-aware auth** — bind sessions to a registered device.
- **Audit logs** — attribute actions to a known device.

Folding device storage into `push_notifications` would force these consumers to depend on the push module. Splitting them is a one-time cost paid in two extra files for clear reuse downstream.

### Why pluggable push providers

FCM + APNs are the obvious defaults but not universal:
- Expo apps need the Expo push API.
- Some apps standardize on OneSignal / Pushwoosh.
- Test/dev environments want a stub provider.

A `PushProvider` interface lets apps register additional providers in `di.ts` without forking the core module.

### Why preferences and registry live in `notifications`

Preferences are inherently cross-channel. If they lived in `push_notifications`, a future `email_notifications` module would either duplicate the table or take a hard dependency on `push_notifications` — both wrong. Keeping them in the channel-agnostic module means each channel reads the same source of truth via a small DI-injected service.

The same logic applies to the type registry: there is one catalogue of "things a system can notify a user about." In-app, push, and future channels are *renderings* of the same catalogue.

## Proposed Solution

### Module 1 — `@open-mercato/core/modules/devices` (new)

Generic device registry. Owns `(tenant, user, device, platform)` and lifecycle. Push-token storage **does not live here** to keep the module channel-agnostic.

**Entities:**
- `UserDevice` (`user_devices`)
  - `id` (uuid PK), `tenant_id`, `organization_id` (nullable), `user_id`
  - `device_id` (client-supplied stable id, e.g. iOS `identifierForVendor`), `platform` (`ios|android|web`)
  - `client_app_version`, `os_version` (text|null)
  - `push_token` (text|null), `push_provider` (text|null — `fcm|apns|expo|...`), `push_token_updated_at` (timestamptz|null)
  - `last_seen_at` (timestamptz)
  - `created_at`, `updated_at`, `deleted_at`
  - Unique: `(tenant_id, user_id, device_id)` for non-soft-deleted rows.

"Active" means `deleted_at IS NULL`. Push delivery additionally requires `push_token IS NOT NULL`.

**APIs** (under `/api/devices`):
- `POST /api/devices` — register/upsert. Idempotent on `(tenant, user, device_id)`. Accepts optional `pushToken`/`pushProvider` so first-register can include both.
- `GET /api/devices` — list current user's own devices.
- `PUT /api/devices/:id` — update `last_seen_at`, `client_app_version`, `push_token`, `push_provider`. Setting `push_token` to `null` is how the client signals revoked OS permission.
- `DELETE /api/devices/:id` — soft-delete (sets `deleted_at`). Server also soft-deletes when a provider returns "unregistered" for a token.

All routes export `openApi`. Use `makeCrudRoute` with `indexer: { entityType: 'devices:user_device' }`.

**ACL features (`acl.ts`):**
- `devices.view`, `devices.manage` (self-serve).
- `devices.admin` (cross-user listing for ops tooling, optional).

**Setup (`setup.ts`):** `defaultRoleFeatures` grants self-serve to employees and customers; admin/superadmin get the wildcard.

**Events (`events.ts`):**
- `devices.user_device.registered`
- `devices.user_device.deactivated`

### Module 2 — Extensions to `@open-mercato/core/modules/notifications`

Two additive surfaces — no breaking changes to existing in-app behavior.

#### 2a. DB-backed type registry

**New entity:** `NotificationType` (`notification_types`)
- `id` (string PK, e.g. `orders.shipped`), `tenant_id` (nullable for system-wide types)
- `label_key` (i18n key — short type name shown in the preferences UI, e.g. `notifications.types.orders_shipped.label`)
- `description_key` (i18n key, nullable — optional helper text for the preferences UI)
- `created_at`, `updated_at`

The actual notification message (title + body) lives on the per-instance `Notification` row, not the type — this entity is just the catalogue. Both keys resolve via locale JSON files (`packages/.../i18n/<locale>.json`); the runtime `translations.ts` system is not used here because types are code-registered, not tenant-defined.

**Mechanism:** at boot, a subscriber listens to `notifications.type_registry.sync` and reconciles registered `NotificationTypeDefinition` calls into the table. The in-memory definition seam stays the source of truth for code; the DB is a read-through mirror so remote clients (mobile apps) can enumerate types.

**API:**
- `GET /api/notifications/types` — registry read for clients (tenant-filtered).

#### 2b. Channel-agnostic preferences

**New entity:** `NotificationPreference` (`notification_preferences`)
- `id` (uuid PK), `tenant_id`, `user_id`
- `notification_type_id` (FK → `notification_types.id`)
- `channel` (string — `in_app`, `push`, future `email`/`sms`)
- `enabled` (bool)
- `created_at`, `updated_at`
- Unique: `(tenant_id, user_id, notification_type_id, channel)`.

**Service:** `NotificationPreferenceService` (DI-registered)
- `isChannelEnabled(userId, typeId, channel): Promise<boolean>` — defaults to `true` when no row exists (lazy-seed pattern).
- `setPreferences(userId, [{typeId, channel, enabled}]): Promise<void>`
- `listForUser(userId): Promise<NotificationPreference[]>`

Channel modules consume this service via DI; they do not query the table directly.

**APIs:**
- `GET /api/notifications/preferences` — current user's prefs (lazy-default to `true` for unset rows).
- `PUT /api/notifications/preferences` — bulk update.

**ACL:** `notifications.manage_preferences` (self-serve, granted by default to all roles).

### Module 3 — `@open-mercato/core/modules/push_notifications` (new)

Push channel only. Reads type registry + preferences from `notifications`, devices from `devices`. Owns deliveries, sender, worker, providers.

**Entities:**

- `PushNotificationDelivery` (`push_notification_deliveries`)
  - `id` (uuid PK), `tenant_id`, `notification_id` (nullable soft FK → `notifications.notifications`), `notification_type_id` (string)
  - `user_device_id` (soft FK → `devices.user_devices` via `data/extensions.ts`), `user_id`
  - `provider` (string — snapshot of the provider used at send time), `token_snapshot` (text — last 8 chars only, for debugging without exposing the full token)
  - `status` (`pending|sent|failed|skipped`), `attempts` (int), `last_error` (text|null)
  - `payload` (JSONB), `provider_response` (JSONB|null)
  - `created_at`, `sent_at`, `updated_at`

  Snapshotting `provider` and the truncated token on the delivery row means the audit trail survives token rotation on the device.

**Services (DI-registered in `di.ts`):**

- `PushSenderService` — orchestrator. Resolves provider per token via `PushProvider` interface; returns `PushResult[]`.
- `MobilePushDeliveryStrategy` — registered via the existing `registerNotificationDeliveryStrategy('push')` seam. Pipeline:
  1. Resolve `NotificationType` from registry (skip if absent).
  2. Check `NotificationPreferenceService.isChannelEnabled(user, type, 'push')` — skip if false.
  3. Load `UserDevice` rows for `(tenant, user)` where `deleted_at IS NULL AND push_token IS NOT NULL`. Skip if none.
  4. Insert `PushNotificationDelivery` rows (status=`pending`, snapshotting `provider` and truncated token).
  5. Enqueue `push_notifications:send-push` worker job.

**Provider interface:**

```ts
// lib/providers/types.ts
export interface PushProvider {
  id: string                                  // 'fcm' | 'apns' | 'expo' | ...
  supports(platform: 'ios' | 'android' | 'web'): boolean
  send(payload: PushPayload, tokens: DevicePushToken[]): Promise<PushResult[]>
}

export type PushPayload = {
  title: string
  body: string
  data?: Record<string, string>
  badge?: number
  sound?: string
}

// PushProvider.send accepts UserDevice rows (with push_token, push_provider, platform).
export type PushResult = {
  userDeviceId: string
  ok: boolean
  providerMessageId?: string
  error?: { code: string; message: string; retryable: boolean }
}
```

Reference implementations: `lib/providers/fcm.ts`, `lib/providers/apns.ts`. Apps register additional providers via Awilix `resolveAll`.

**Worker:**
- `workers/send-push.worker.ts` — picks pending `PushNotificationDelivery` rows, batches by provider, retries with exponential backoff (3 attempts default). Marks `sent`/`failed`. On provider "unregistered" responses, soft-deletes the source `UserDevice` row. Idempotent on delivery id.

**No token-management APIs in this module.** Push tokens are device fields, set/cleared via `PUT /api/devices/:id` in the `devices` module.

**Backend admin pages** (under `/backend/push-notifications/`):
- `page.tsx` — delivery log list (filter by status, user, date range).
- `[id]/page.tsx` — delivery detail.

**ACL features (`acl.ts`):**
- `push_notifications.view_deliveries` (admin observability).

**Events (`events.ts`):**
- `push_notifications.delivery.sent`
- `push_notifications.delivery.failed`

### Designing for email/SMS without building them

The shape this spec locks in for v1 is what makes future channels cheap:

- `NotificationPreference.channel` is a free-form string. Adding `email` is new rows, no schema change.
- The existing `registerNotificationDeliveryStrategy(channel)` seam in `notifications` is the integration point. A future `email_notifications` module:
  1. Registers a `DeliveryStrategy` under `'email'`.
  2. Owns its own credentials, identity (e.g. verified email addresses), worker, delivery log.
  3. Reads `NotificationPreferenceService.isChannelEnabled(user, type, 'email')`.
- `NotificationDispatcher` in `notifications` already fans out to registered strategies; preferences are consulted per channel inside each strategy (not centrally) so each channel can have its own skip-conditions.
- No "send anything" facade — channel modules stay independent and swappable.

When categories/governance return as a later spec, they are additive: a new `category` column on `NotificationType`, a new optional preference fallback (type → category), and an optional `FrequencyGuard` service. Nothing in this spec blocks that.

## Architecture (file-level map)

```
packages/core/src/modules/devices/
  index.ts
  acl.ts
  setup.ts
  events.ts
  data/entities.ts          # UserDevice
  data/validators.ts
  api/get/devices.ts
  api/post/devices.ts
  api/put/devices/[id].ts
  api/delete/devices/[id].ts
  api/openapi.ts
  backend/page.tsx          # admin: list devices (gated by devices.admin)
  migrations/Migration*.ts
  AGENTS.md
  __integration__/devices.spec.ts

packages/core/src/modules/notifications/        # extending existing module
  data/entities.ts                              # ADD: NotificationType, NotificationPreference
  data/validators.ts                            # ADD: type/preference schemas
  lib/type-registry.ts                          # ADD: in-memory ↔ DB sync
  lib/preference-service.ts                     # ADD: NotificationPreferenceService
  subscribers/sync-notification-types.ts        # ADD: boot-time registry sync
  api/get/types.ts                              # ADD
  api/get/preferences.ts                        # ADD
  api/put/preferences.ts                        # ADD
  migrations/Migration*.ts                      # ADD migration for two new tables
  __integration__/types-and-preferences.spec.ts # ADD

packages/core/src/modules/push_notifications/
  index.ts
  acl.ts
  setup.ts
  events.ts
  data/entities.ts          # PushNotificationDelivery
  data/validators.ts
  data/extensions.ts        # links to devices.user_devices and notifications.*
  di.ts                     # registers PushSenderService, providers
  lib/push-sender.ts
  lib/providers/types.ts
  lib/providers/fcm.ts
  lib/providers/apns.ts
  lib/push-delivery-strategy.ts
  workers/send-push.worker.ts
  api/openapi.ts
  backend/page.tsx          # delivery log list
  backend/[id]/page.tsx     # delivery detail
  migrations/Migration*.ts
  AGENTS.md
  __integration__/push-notifications.spec.ts
```

## Data Models

See entity definitions above. Key design notes:

- `UserDevice` carries push-token fields directly. Splitting tokens into a separate entity is YAGNI for v1 — single token per `(device, app install)` is the universal case for FCM/APNs/Expo, and a future split is a single migration if a real edge case ever shows up.
- Soft-delete via the standard `deleted_at` column; no separate `is_active` flag.
- `PushNotificationDelivery` references `user_device_id` and snapshots `provider` + a truncated `token_snapshot` so the delivery audit trail survives both token rotation and device deletion.
- `NotificationPreference.channel` is a free-form string for forward compatibility with email/SMS.
- `NotificationPreference` rows are **lazy-seeded**: when no row exists, the channel is treated as enabled (default-on). This avoids backfilling preferences for every existing user when a new type is added.
- `NotificationType.label_key` / `description_key` resolve via locale JSON files, not the runtime `translations.ts` system, because types are code-registered, not tenant-defined.
- Cross-module references use `data/extensions.ts` (`defineLink`), not direct ORM relationships.

## API Contracts

Schemas in `data/validators.ts` (zod). Highlights:

```ts
// POST /api/devices
const RegisterDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  platform: z.enum(['ios', 'android', 'web']),
  clientAppVersion: z.string().optional(),
  osVersion: z.string().optional(),
  pushToken: z.string().min(1).optional(),
  pushProvider: z.string().min(1).optional(),
})

// PUT /api/devices/:id
const UpdateDeviceSchema = z.object({
  clientAppVersion: z.string().optional(),
  osVersion: z.string().optional(),
  pushToken: z.string().min(1).nullable().optional(),  // null clears (e.g. user revoked OS permission)
  pushProvider: z.string().min(1).nullable().optional(),
})

// PUT /api/notifications/preferences
const UpdatePreferencesSchema = z.object({
  preferences: z.array(z.object({
    notificationTypeId: z.string(),
    channel: z.string(),
    enabled: z.boolean(),
  })),
})
```

All routes wire `openApi` via `createCrudOpenApiFactory`.

## Integration Test Coverage

Per `.ai/qa/AGENTS.md` — self-contained, fixtures created in setup, cleaned in teardown.

**`devices` module:**
- Register → list → update last-seen → soft-delete.
- Register with `pushToken` set on first call; later `PUT` with `pushToken: null` clears it.
- ACL: a non-admin user cannot list another user's devices.
- Idempotency: re-registering same `(user, device_id)` upserts, does not duplicate.

**`notifications` module (new surfaces):**
- Boot fires `notifications.type_registry.sync`; subscribers register types; `notification_types` reflects DB state.
- `NotificationPreferenceService.isChannelEnabled` returns `true` when no row exists; `false` after explicit opt-out; round-trips across `setPreferences`.

**`push_notifications` — strategy + provider:**
- With a stub `PushProvider`, fire `notificationService.create()` for a push-enabled type → assert `PushNotificationDelivery` row enqueued (status=`pending`) → run worker → status transitions to `sent`, `provider_response` populated.
- Failed provider call → retried 3× → final status `failed`, `last_error` populated.
- Provider returns "unregistered" → worker soft-deletes the source `UserDevice` row.
- Opt-out via `PUT /api/notifications/preferences` (`channel='push'`, `enabled=false`) → next dispatch skips delivery (no row enqueued).
- Device with `push_token=null` → strategy skips it (no row enqueued).

**`push_notifications` — admin pages:**
- Filter by status/user/date.
- Detail page renders payload + provider response.
- ACL: page gated by `push_notifications.view_deliveries`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Module-shape bikeshed: reviewers prefer one merged module over three | Medium | Module boundary | Spec lists explicit reuse cases for `devices` (MFA #539, audit, sessions) and channel-agnostic justification for putting prefs/registry in `notifications`. Reversible if reuse never materializes. | Low. |
| Provider abstraction adds complexity for apps that only need FCM+APNs | Low | DX | Default `di.ts` registration ships FCM+APNs out of the box. Apps that don't extend never see the provider seam. | Low. |
| FCM/APNs credentials in env are sensitive; misconfig leaks tokens to logs | High | Security | Provider implementations MUST NOT log tokens or full payloads. Add a redact filter in `push-sender.ts` and a unit test asserting redaction. Document env keys in `AGENTS.md`. | Low after redaction test. |
| Lazy preference seeding = surprise opt-in for existing users when a new type is added | Medium | UX | Default-on contract documented. Apps that want default-off insert explicit `enabled=false` rows during type registration. | Low. |
| `push_notification_deliveries` table grows unbounded | Medium | Storage | Periodic purge worker (90-day default, configurable per tenant). Declared in this spec; landed as a Phase 6 follow-up if it slips. | Medium until purge ships. |
| Notification type IDs are FROZEN (per BACKWARD_COMPATIBILITY.md) — typos stick forever | High | BC contract | Document the frozen-id contract in `AGENTS.md`. Migration tooling for renames left to a future spec. | Low. |
| Mobile clients depend on stable token-register endpoint shapes | High | API contract | Lock request/response schemas in this spec; mark routes STABLE per BC contract. Additive-only changes thereafter. | Low. |
| Existing `notifications` module's in-memory registry diverges from new DB registry | Medium | Module overlap | DB registry is a read-through mirror, not a replacement. Same source of truth (`registerNotificationTypes` calls), two storage layers. Sync subscriber reconciles on boot. | Low. |
| Preferences service introduces an extra DB read per dispatch | Low | Performance | Service caches per-request via DI; bulk-loads when dispatching to many users. Worst case is a few extra ms per send. | Low. |
| Splitting prefs/registry from `push_notifications` means push module depends on `notifications` | Low | Coupling | This is correct: every channel depends on the channel-agnostic registry. The dependency is unidirectional and matches the existing strategy seam. | None. |

## Open Questions

- `PushProvider` discovery: Awilix `resolveAll` (DI-idiomatic in this codebase) vs. an explicit `registerPushProvider()` registry? **Recommendation:** Awilix `resolveAll` over an `Array<PushProvider>` token; mirrors how the codebase wires other plugin seams.
- Should `NotificationPreference` carry an optional `tenant_id`-scoped row to support tenant-level defaults (admin overrides "all users default to push-off for marketing types")? **Recommendation:** out of scope for this spec; revisit when categories/governance return.
- Should the `notifications` module's existing `Notification.channels` JSONB column be deprecated in favor of resolving channels per-dispatch from preferences? **Recommendation:** no — `channels` records what was attempted at create time (audit), preferences gate what gets attempted. Distinct concerns.

## Implementation Phases

Each phase ends with passing integration tests + green build. One PR per phase.

1. **Phase 1 — `devices` module.** Entities, migrations, APIs, ACL, setup, integration tests. Standalone — no dependents yet.
2. **Phase 2 — `notifications` extensions.** `NotificationType` + `NotificationPreference` entities, migrations, type registry sync subscriber, `NotificationPreferenceService`, type/preference APIs, integration tests. No new channels yet.
3. **Phase 3 — `push_notifications` rails.** `PushNotificationDelivery`, strategy registration consuming Phase 2 service and reading `UserDevice` rows from Phase 1, send-push worker, stub `PushProvider` for tests.
4. **Phase 4 — Reference providers (FCM + APNs).** Provider implementations, env config, log redaction. Documented in `AGENTS.md`.
5. **Phase 5 — Backend admin pages.** Delivery log list/detail.
6. **Phase 6 (follow-up).** Purge worker, web push, additional providers. Categories/priority/non-opt-out/frequency caps land as a separate later spec when an app needs them.

## Verification

### Local

1. `yarn db:migrate` applies new tables.
2. Boot — `notifications.type_registry.sync` fires; types appear in `notification_types`.
3. Register a device with a `pushToken` via `/api/devices` → fire a `notificationService.create()` for a known type → verify delivery row enqueued, worker processed, stub provider called.
4. `PUT /api/notifications/preferences` with `(type, 'push', enabled=false)` → repeat dispatch → verify no new delivery row.

### Automated

- `packages/core/src/modules/devices/__integration__/`
- `packages/core/src/modules/notifications/__integration__/types-and-preferences.spec.ts`
- `packages/core/src/modules/push_notifications/__integration__/`
- `yarn test:integration` runs all green.

### Compliance

- `packages/core/AGENTS.md` patterns: `makeCrudRoute`, `openApi`, `setup.ts`, `acl.ts`, `events.ts`, cross-module links via `data/extensions.ts`, integration suites colocated.
- `BACKWARD_COMPATIBILITY.md`: type IDs treated FROZEN; entity columns ADDITIVE-ONLY going forward; API URLs STABLE.
- Design system: backend admin pages use `DataTable`, `StatusBadge` (delivery status map: `pending→info`, `sent→success`, `failed→error`, `skipped→neutral`), `EmptyState`, `LoadingMessage`. No hardcoded status colors.

## Final Compliance Report

To be filled in after implementation; expected:

- [ ] All routes export `openApi`
- [ ] Module entities follow snake_case table names with `<module>_` prefix
- [ ] No direct ORM relationships across module boundaries (links declared via `data/extensions.ts`)
- [ ] All write routes use the Command pattern OR `makeCrudRoute`
- [ ] Provider implementations redact tokens and payloads from logs
- [ ] Integration suites self-contained and stable
- [ ] `AGENTS.md` shipped with each new module; existing `notifications/AGENTS.md` updated for new surfaces
- [ ] No hardcoded design-system colors or arbitrary text sizes
- [ ] `yarn lint` and `yarn build` green
- [ ] BC contract honored (type IDs frozen, additive-only schema changes thereafter)

## Changelog

- **2026-04-28** — Initial draft. Three-part change: new `devices` module (generic device registry), new `push_notifications` module (push tokens + strategy + provider seam + worker), and additive extensions to existing `notifications` module (DB-backed type registry + channel-agnostic preferences). Categories, priority, non-opt-out, and daily/weekly frequency caps deferred to a later spec. Email/SMS channels designed-for but not built. Verified no existing upstream issue/PR via `gh search` on 2026-04-28. Design informed by a downstream production implementation; app-specific coupling is stripped for core.
