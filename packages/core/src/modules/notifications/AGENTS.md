# Notifications Module — Agent Guidelines

In-app notifications plus two channel-agnostic surfaces that every delivery channel (in-app, push, future email/SMS) reads from: a **DB-mirrored notification type catalogue** and **per-user channel preferences**. See `.ai/specs/2026-04-28-push-notifications-and-devices.md` (Phase 2).

## Always

- Register new notification types in your **own** module's `notifications.ts` (`notificationTypes: NotificationTypeDefinition[]`). The generator aggregates them; `bootstrap.ts` feeds the aggregate into the in-memory registry (`lib/notification-type-registry.ts`) via `registerNotificationTypes(...)`. Do **not** add a defaults array here.
- Read channel preferences through `NotificationPreferenceService` (DI: `notificationPreferenceService`) — never query `notification_preferences` directly from another module. Use `isChannelEnabled(scope, typeId, channel)` (defaults to `true` when no row exists — lazy-seed, default-on).
- Keep type ids **FROZEN** (BACKWARD_COMPATIBILITY.md): once a `NotificationTypeDefinition.type` ships it is a stable contract; renames need the deprecation protocol.
- Keep API URLs **STABLE**: `/api/notifications/types`, `/api/notifications/preferences` are additive-only.
- Wire custom write routes through the mutation guard via `runGuardedNotificationWrite(...)` in `lib/routeHelpers.ts` (the preferences `PUT` does this).

## Delivery channels & the gate (Phase 7)

- **Every channel is a strategy on one seam.** `in_app`, `email`, and `push` are all `NotificationDeliveryStrategy` objects (`lib/deliveryStrategies.ts`), registered via a `notifications.delivery-strategies.ts` convention file discovered by the `delivery-strategies` generator plugin. `in_app` is a no-op strategy — the durable `Notification` row IS the in-app delivery; its bell/inbox **visibility** is `in_app ∈ notification.channels` (see `lib/notificationVisibility.ts`), applied at the read layer, not by the strategy.
- **One gate, at create time.** `notificationService.create*` calls `resolveEffectiveChannels` (`lib/shouldDeliver.ts`) once per recipient — composing per-send target (`input.channels`) ∩ per-type eligibility (`NotificationTypeDefinition.channels`) ∩ registered strategies ∩ the recipient's per-channel preference (`nonOptOut` bypasses opt-out; `silent` is orthogonal) — and snapshots the result on `Notification.channels`. The dispatch subscriber then just loops the registered strategies filtered by that set (`NULL ⇒ all channels`, legacy/BC). **Do not** re-implement opt-out logic inside a strategy — the gate already ran. Use `isConfigured(ctx)`/`supports(notification)` only for technical deliverability.
- **Absent `channels` on a create call ⇒ all channels** (unchanged behavior). Pass `channels: ['push']` (etc.) to target a subset.
- **Channel catalogue.** Add a channel's UI metadata by exporting `notificationChannels: NotificationChannelDefinition[]` from a `notification-channels.ts` (generator-discovered → `getNotificationChannels()` → `GET /api/notifications/channels`; the preferences UI reads it). Keep each delivery-strategy `id` and its channel-definition `id` in sync — behavior layer (strategy registry) + metadata layer (channel registry), same id.
- **When adding an in-app read surface** (a new bell/inbox/count query), AND-in `inAppVisibleFilter()` so suppressed rows stay hidden.

## Never

- Never create a cross-module ORM relationship to `notification_types` / `notification_preferences`. `NotificationPreference.notificationTypeId` is a **soft string ref** to a type id, not a FK relation.
- Never gate per-user opt-out inside a delivery strategy — enforcement is centralized in the create-time gate (`shouldDeliver`). A strategy that re-checks preferences double-counts and drifts.
- Never write per-tenant rows into `notification_types`. Code-registered types are **system-wide** (`tenant_id IS NULL`); the column is nullable only to leave room for future tenant-defined types.
- Never expose another tenant's preferences — all reads/writes are scoped by `(tenantId, userId)`.

## Type catalogue (read-through mirror)

- The in-memory `NotificationTypeDefinition` registry is the source of truth for code. `notification_types` is a **read-through DB mirror** so remote clients (mobile apps) can enumerate types over HTTP without shipping the catalogue.
- `syncNotificationTypes(em)` reconciles the registry into the table (idempotent, `tenant_id IS NULL`). It runs lazily on the first `GET /api/notifications/types` per process and on the `notifications.type_registry.sync` event (emitted from `setup.ts` `seedDefaults`; handled by `subscribers/sync-notification-types.ts`).
- Field map: `id ← def.type`, `label_key ← def.labelKey ?? def.titleKey`, `description_key ← def.descriptionKey ?? null`. Give a type a distinct preferences-screen label by adding optional `labelKey`/`descriptionKey` to its `NotificationTypeDefinition` (additive — falls back to `titleKey`).
- Mark a type `silent: true` on its `NotificationTypeDefinition` to make its pushes content-available wake-ups (no banner, data-only). `silent` controls **delivery style only** — the notification still flows through the normal `notificationService.create()` path (in-app row created, per-channel push preference respected); to make a silent type always fire, also mark it `nonOptOut: true`. There is no separate silent-send API — the `push` delivery strategy handles `silent` types. The flag lives only in the in-memory registry (not mirrored to `notification_types`).
- A create call may carry an optional `data` (arbitrary app-readable string map — persisted on the row, exposed in the notification DTO, and delivered in the push data payload) and `pushOptions` (flat `sound`/`badge`/`image`/`priority`/`channelId`/`body` map — persisted, push-only, mapped per provider by the push adapters). Both are additive optional fields on the create/batch/role/feature schemas.

## Preferences & optimistic locking

- `NotificationPreference` carries `updated_at` but is **intentionally excluded** from the curated `optimistic-lock-editable-entities.test.ts` `notifications` list: it is an idempotent, lazy-seeded self-setting written through a service (`setPreferences`) + mutation guard, **not** `CrudForm`/`makeCrudRoute`, so a lost-update undo stack adds no value. When a preferences UI lands (Phase 5), its mutating call must either send the optimistic-lock version header or carry an inline `optimistic-lock-exempt` marker to satisfy `optimistic-lock-ui-coverage.test.ts`.

## ACL

- `notifications.view`, `notifications.create`, `notifications.manage`, `notifications.manage_preferences` (self-serve; granted to all default roles). After editing `acl.ts`, run `yarn mercato auth sync-role-acls`.

## Validation

```bash
yarn generate
yarn db:generate            # diff probe; keep only the notifications migration + snapshot
yarn workspace @open-mercato/core build
yarn workspace @open-mercato/core test
```
