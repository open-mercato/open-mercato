# push_notifications Module — Agent Guidelines

Push delivery **rails**. Owns the delivery log, the `push` notification delivery strategy, and the
`send-push` worker. It does **not** own device tokens (that's `devices`), per-user opt-out (that's
`notifications`), or provider credentials/transport (that's the `communication_channels` hub +
FCM/APNs/Expo channel packages). Spec: `.ai/specs/2026-04-28-push-notifications-and-devices.md` (Module 3).

## Architecture

- **Strategy** (`lib/push-delivery-strategy.ts`) registers via the notifications `delivery-strategies`
  generator plugin (export `deliveryStrategies` from `notifications.delivery-strategies.ts`). It runs
  inside the persistent `notifications:deliver` subscriber and only enqueues — the actual send happens
  in the worker so a slow provider never blocks notification creation.
- **Worker** (`workers/send-push.worker.ts` → `lib/push-delivery.ts`) atomically claims the row
  (`pending` → `sending`, so a redelivered at-least-once job is processed once), resolves the tenant push
  `CommunicationChannel` + hub adapter (`channelAdapterRegistry`) + creds (`integrationCredentialsService`)
  and calls `convertOutbound` → `sendMessage` — the `communication_channels` `test-send` flow. Retries
  transient failures with exponential backoff + jitter (3 attempts, shared
  `@open-mercato/shared/lib/delivery/retry`), records `next_retry_at`, and marks the row `expired` once
  retries are exhausted (vs `failed` for terminal errors); on the `unregistered` sentinel soft-deletes the device.
- **Queue** (`lib/queue.ts`) mirrors the webhooks queue: `createModuleQueue` + `enqueuePushDelivery` +
  a local-worker bootstrap for dev/test (`QUEUE_STRATEGY !== 'async'`).
- **Reaper** (`lib/push-reaper.ts` → `workers/reclaim-stuck.worker.ts`) recovers rows stranded in
  `sending` by a crashed worker — the send-path claim only matches `pending`, so such a row has no
  outstanding job and would never terminate. A per-tenant `@open-mercato/scheduler` interval entry
  (registered best-effort in `setup.ts`, mirroring the `communication_channels` poll-tick) fires the
  tick; rows still in `sending` past `OM_PUSH_STUCK_RECLAIM_MINUTES` (default 5) are re-opened +
  re-enqueued when attempts remain, else finalized `expired`. Each transition is an atomic
  `nativeUpdate` guarded on `status='sending'` + still-stale `updated_at`, so overlapping ticks or a
  worker that re-claimed the row never re-open an active delivery. The per-tick scan is batch-bounded
  by `OM_PUSH_STUCK_RECLAIM_BATCH_LIMIT` (default 500, oldest-stuck first) so a stranded backlog from a
  provider/queue outage cannot load an unbounded row set into memory in one tick — the remainder drains
  on subsequent ticks (mirrors the receipt reaper's `OM_PUSH_RECEIPT_BATCH_LIMIT`).
- **Fan-out** (`lib/push-fanout.ts`, `fanOutPushDeliveries`) is the shared device-resolution + provider
  routing + delivery-row insert + enqueue. The strategy (visible notifications) and `sendCustomPush`
  call it; it stays preference-agnostic. Its channel/device short-circuits (no push channel / no
  devices / no provider match → `{ enqueued: 0 }`) are push's technical `isConfigured` equivalent and
  remain the authoritative "is push set up for this tenant/recipient" check.
- **Opt-out is enforced upstream, once (Phase 7).** The `push` strategy no longer calls
  `isChannelEnabled`/checks `nonOptOut`; the notifications create-time gate (`shouldDeliver`) already
  resolved per-channel opt-out into `notification.channels`, and the dispatcher only invokes this
  strategy when `push ∈ channels`. The strategy still reads the **type** for `silent` (delivery style).
- **Silent push** is **not** a separate API — it is just a notification whose **type** is declared
  `silent: true` (`NotificationTypeDefinition.silent`), created through the **normal**
  `notificationService.create()` flow (`create()` → `notifications:deliver` subscriber → the `push`
  strategy). The strategy derives `silent` from the type, sends a content-available (data-only) push,
  and skips user-facing copy; the in-app `Notification` row is still created and per-channel
  preferences still apply (now enforced by the notifications create-time gate, not the strategy) — to
  make a silent type always fire, declare it `nonOptOut: true`. There is no `sendSilentPush` helper.
- **Admin custom push** (`lib/send-custom-push.ts`, exposed in DI as `pushNotificationService`) is a
  one-off **visible** push with literal title/body that fans out directly (no in-app row, no email, no
  preference check); it backs `api/custom-send/route.ts`.
- **Flexible payload.** A notification's optional `data` (arbitrary app-readable map, also exposed to
  in-app clients) and `pushOptions` (flat `sound`/`badge`/`image`/`priority`/`channelId`/`body` map, both
  from the `notifications` module) ride the push envelope `raw`. The adapters map `pushOptions` onto each
  provider's native message and branch on `silent`; see `communication_channels/lib/push-envelope.ts`
  (`PushOptions`, `readPushEnvelope`, `resolvePushBody`).

## Always

- Never export `OM_PUSH_FAKE_PROVIDERS` by hand and point `TC-PUSH-004+` / `TC-CHANNEL-PUSH-005..007` at a
  live server that does not itself have it. Their `.meta.ts` gate skips them when the flag is absent from the
  test process, which is the protection you want; exporting it defeats that gate. The fake swaps the provider
  SDK client in `di.ts` `register()`, so whichever process claims the delivery job must have the flag — a dev
  server without it runs its in-process worker against the **real** provider, and on real credentials that
  means a real push to the recipient's real devices. Start the server with `OM_PUSH_FAKE_PROVIDERS=1`, or use
  the ephemeral harness, which sets it for both the app and the drain child.
- Resolve cross-module entities (`UserDevice`, `CommunicationChannel`) via DI tokens (`ctx.resolve(...)`),
  not import-time references, to stay decoupled.
- Keep `push_token` a secret: persist only `provider` + last-8 `token_snapshot`; never expose a full token
  in any API/UI/log.
- Soft-delete an `unregistered` device through the `devices.user_devices.deactivate` command (system ctx:
  `auth: null, systemActor: true`) — never mutate the `devices` table directly.
- Keep the `unregistered` sentinel identical across provider adapters (`result.metadata.unregistered ===
  true` or `result.error === 'device_unregistered'`) so the worker's soft-delete fires uniformly.
- Keep the delivery log append-only (status transitions only); it is intentionally optimistic-lock-exempt.
- To send a silent push, declare the notification type `silent: true` (in its module's
  `notifications.ts`) and create it via the normal `notificationService.create()` — the `push`
  strategy turns it into a content-available wake-up. Do not add a bespoke silent-send path.

## Never

- Never add token-management or self-serve notification CRUD here (device fields live in `devices`).
- Never introduce a `PushProvider` interface — the hub `ChannelAdapter` registry is the provider seam;
  real providers are separate `channel-*` packages (Phase 4).

## Validation

```bash
yarn workspace @open-mercato/core test -- push_notifications
yarn workspace @open-mercato/core build
```
