# Push Delivery E2E — Critical Findings (FCM)

**Date:** 2026-07-01
**Context:** End-to-end validation of the push stack (`devices` → `push_notifications` → `channel-fcm`) against a real Android emulator, a throwaway Expo app, and a real Firebase project.

## TL;DR

**RESOLVED (2026-07-01).** The whole failure collapsed to **one root cause** — notifications created via `POST /api/notifications` never carried an organization (`org=null`), while devices, push channels, and their encryption maps are all org-scoped. A one-line-of-intent fix in `resolveNotificationContext` (derive the org the same way `devices` and the Phase 6 custom-send route already do) makes the **real** pipeline deliver a visible push to the emulator, **foreground and background**, with the delivery row `sent` and the token snapshot showing plaintext. See § Resolution.

Original diagnosis (kept for the record): the **FCM delivery capability is proven working**: a real FCM service account + the device's real FCM token (decrypted from the encrypted `user_devices.push_token` column) + `firebase-admin` produced a **visible notification on the emulator**. Device registration, at-rest token encryption (on write), credential validation-at-connect, and the mobile integration all work.

The **automatic backend delivery pipeline did NOT work end-to-end** before the fix. In a normal org-enabled tenant a created notification produced **zero** push deliveries, and even after working around that, the send failed with `invalid_fcm_credentials`. What looked like three distinct bugs turned out to be three *symptoms* of the single org-propagation gap (Findings 2 & 3 are downstream of Finding 1 — see each finding's update note). They are independent of provider/keys — the FCM adapter itself is fine.

## Reproduction / environment

- Backend: this worktree's `apps/mercato` on `:3004`, `TENANT_DATA_ENCRYPTION=yes` (only `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` set), local queue with in-process workers.
- Seeded `admin@acme.com` — `tenantId=036f0f00-…`, `orgId=692b77da-…`.
- Device registered via `POST /api/devices` from the app → `platform=android`, `push_provider=fcm`, `push_token` stored encrypted, `organization_id=692b77da` (org-scoped).
- FCM push channel connected via `POST /api/communication_channels/channels/connect/credentials` (`providerKey=fcm`) → `channel_type=push`, `status=connected`, credential row under `organization_id=692b77da`, `user_id=admin`.
- Trigger: `POST /api/notifications` (`type=messages.new`, `recipientUserId=admin`).

## Finding 1 — Notifications are ALWAYS created tenant-level (org = null); org-scoped devices never receive push  **[BLOCKER]**

`resolveRequestContext` builds its context without ever populating `selectedOrganizationId`:

- `packages/shared/src/lib/api/context.ts` (`resolveRequestContext`) returns `{ container, auth, translate }` — `selectedOrganizationId` is declared on the type but never set (always `undefined`).
- `packages/core/src/modules/notifications/lib/routeHelpers.ts:79` → `organizationId: ctx.selectedOrganizationId ?? null` ⇒ **every notification created via `POST /api/notifications` (and batch/role/feature variants) has `organization_id = NULL`.** Confirmed in DB across 4 attempts.

The push delivery strategy then loads recipient devices scoped to the notification's org:

- `packages/core/src/modules/push_notifications/lib/push-delivery-strategy.ts` (step 4) queries `UserDevice` with `organizationId = notification.organizationId` (null).

But devices register **org-scoped**:

- `packages/core/src/modules/devices/api/route.ts:83` → `organizationId = scope?.selectedId ?? auth.orgId ?? null` ⇒ a device registered by a user with an org gets that org (`692b77da`).

**Effect:** null-org notification vs org-scoped device ⇒ the strategy finds **0 devices** ⇒ **no `PushNotificationDelivery` row is ever created**, no job enqueued, silent no-op. Any tenant whose users have an organization can never receive push via the notifications API. This is the first and hard blocker.

**Root asymmetry:** devices derive org from `auth.orgId`; notifications never derive an org at all. The two must agree. Either notifications must inherit the creator's org (`ctx.selectedOrganizationId ?? auth.orgId ?? null`, matching the CRUD factory's own convention at `packages/shared/src/lib/crud/factory.ts:2147`), or the strategy must also match tenant-level devices when the notification is tenant-level. Today neither happens.

## Finding 2 — Worker resolves channel credentials under the wrong organization ⇒ `invalid_fcm_credentials`  **[BLOCKER, downstream of #1]**

After forcing the device to tenant-level (`organization_id = NULL`) to get past #1, a delivery row is created and the `send-push` worker runs — and fails.

- `packages/core/src/modules/push_notifications/lib/push-delivery.ts:213` resolves credentials with `organizationId: job.organizationId ?? job.tenantId`. For a tenant-level delivery (`job.organizationId = null`) this becomes **`job.tenantId`** — a *tenant* UUID used as an *organization* id.
- Credentials were saved at connect time under `auth.orgId` (`692b77da`) via `connect-credential-channel` (route passes `organizationId: auth.orgId ?? null`).
- `buildCredentialsFilter` (`packages/core/src/modules/integrations/lib/credentials-service.ts:66`) matches `organization_id` **exactly**. `036f0f00 (tenantId) ≠ 692b77da (connect org)` ⇒ no row ⇒ empty credentials ⇒ `fcmCredentialsSchema.safeParse` fails ⇒ adapter returns `invalid_fcm_credentials` ⇒ 3 retries ⇒ `expired`.

**Update (resolved — downstream of Finding 1, do NOT change the worker):** the `?? job.tenantId` fallback is not a stray bug — it deliberately **mirrors the connect command's credential-save scope**. `connect-credential-channel.ts:109` saves credentials under `organizationId: input.scope.organizationId ?? input.scope.tenantId`, so the worker resolves them under the same `organizationId ?? tenantId` shape. Save-scope and lookup-scope already agree by construction. The only reason the lookup missed in the failed run was that `job.organizationId` was `null` (Finding 1) while credentials were saved under the real org (`org ?? tenantId` = real org) ⇒ `null ?? tenantId` = tenantId ≠ real org. Once the notification carries the real org (Finding 1 fix), `job.organizationId` = real org = credential org and the lookup matches — verified `sent`, `attempts=1`. **Removing `?? job.tenantId` would break tenant-level (null-org) channels**, whose credentials genuinely live under `tenantId`, so it was left untouched.

## Finding 3 — Encrypted columns are NOT decrypted on read in the delivery path  **[BLOCKER, latent behind #2]**

The strategy snapshots the device token from a decrypting read, but the value is still **ciphertext**:

- `push-delivery-strategy.ts` computes `tokenSnapshot(device.pushToken)` where `device` comes from `findWithDecryption(...)`. The persisted `token_snapshot` was `CVg==:v1` — i.e. the last 8 chars of the **AES-GCM envelope** (`…:v1`), not the plaintext token.
- Independent proof the data is fine: deriving the tenant DEK exactly as `packages/shared/src/lib/encryption/kms.ts` does (`pbkdf2(sha256(TENANT_DATA_ENCRYPTION_FALLBACK_KEY), tenantId, 310000, 32, sha512)`) and running `decryptWithAesGcm` yields the **correct** token (tail `…NqJpbQ2o`, matching what the app displayed). So encryption-on-write is correct; **read-side decryption is not being applied.**
- The same class of failure independently sinks the credential blob path (`decryptCredentialsBlob` / `findOneWithDecryption` in `credentials-service.ts`), reinforcing Finding 2's `invalid_fcm_credentials`.

**Update (resolved — same root cause as Finding 1):** this was never a decryption *code* bug. `TenantDataEncryptionService` looks up the per-tenant/org `encryption_maps` row by exact `(entity_id, tenant_id, organization_id)`. The strategy and worker already pass the notification's / job's org to `findWithDecryption`/`findOneWithDecryption` (strategy `push-delivery-strategy.ts:89`, worker `push-delivery.ts:179`). When `organizationId` was `null` (Finding 1) the map lookup found no org-scoped map for the device's real org, so the envelope was returned undecrypted — hence the `CVg==:v1` snapshot. With the org propagated correctly, the read uses the device's own org-scoped map and returns plaintext: the live delivery row's `token_snapshot` is now `NqJpbQ2o` (the plaintext tail the app displays), not the `…:v1` envelope tail. No change to the encryption/read path was needed.

## What works (verified)

- `POST /api/devices` self-registration, org/tenant/user binding, `push_token` **encrypted on write**, never exposed in API responses.
- `POST /api/communication_channels/channels/connect/credentials` for `fcm` → derives `channel_type=push`, validates the service account at connect time (bad key → 422).
- FCM adapter send path (`firebase-admin` `cert()` + `messaging().send()`), a minted FCM service account, and the app's real FCM token — **direct send produced a visible push on the emulator.**
- Mobile: Expo + `@react-native-firebase/messaging`, token acquisition, `POST /api/devices`, foreground `onMessage` + background handler.

## Resolution (2026-07-01) — fixed & verified e2e

**The fix is one place, and it matches how the rest of the codebase already scopes org-bound writes.** `resolveRequestContext` deliberately does not populate `selectedOrganizationId` (it is byte-identical to `develop` and shared by every module), so the notification layer must derive the org itself — exactly like the `devices` registration route (`devices/api/route.ts:82-83`) and the Phase 6 push custom-send route already do.

`packages/core/src/modules/notifications/lib/routeHelpers.ts` → `resolveNotificationContext` now resolves the org via the sanctioned helper and falls back to the caller's own org:

```ts
const orgScope = await resolveOrganizationScopeForRequest({ container: ctx.container, auth: ctx.auth, request: req })
// ...
organizationId: orgScope?.selectedId ?? ctx.auth?.orgId ?? null,
```

This is the single change to production code. It fixes all three symptoms at once because every downstream stage was already org-correct: the strategy matches devices by `notification.organizationId`, `findWithDecryption` reads the device's org-scoped encryption map, and the worker resolves credentials under `job.organizationId ?? job.tenantId` (which now hits the real org). **Findings 2 and 3 required no code change** — see their update notes (touching the worker's `?? tenantId` would have regressed tenant-level channels).

### Verified end-to-end (clean reseed, real pipeline, no SQL hacks)

Fresh DB reseed (tenant `d4ecd649…`, org `d8bcbc99…`, admin `72b66a19…`); device + FCM push channel + credentials all org-scoped to `d8bcbc99`. Registered from the throwaway Expo app on the Android emulator, then triggered the **real** `POST /api/notifications` (no direct `firebase-admin`, no DB edits):

- `notifications.organization_id` = `d8bcbc99` ✅ (was `NULL` before the fix)
- `push_notification_deliveries`: `status=sent`, `provider=fcm`, `attempts=1`, `token_snapshot=NqJpbQ2o` (plaintext tail), `last_error=null` ✅
- **Foreground** — app's `onMessage` displayed "E2E real pipeline ✅ — open-mercato → send-push worker → FCM → emulator" ✅
- **Background** — app backgrounded; the OS notification tray showed the FCM `notification` payload ("E2E background push 🔔 — delivered while app not focused") ✅
- `GET /api/push_notifications/deliveries?status=sent` returns both rows with the truncated token only (full token never exposed) ✅

### Follow-up (not blocking)

- Add an **integration test** that registers a device via the API and drives a notification through the delivery path under `TENANT_DATA_ENCRYPTION=yes`, asserting the delivery row reaches `sent` with a plaintext `token_snapshot` — locking in the org-propagation contract at the integration layer (the unit coverage below pins it at the route + strategy layers).

## Regression analysis — vs `develop` and Phases 5 / 6

**Not a regression.** Diffing this branch against `origin/develop`: the `devices` and `push_notifications` modules are entirely **new** (absent on develop); the whole delta is **4160 insertions / 0 modifications** to pre-existing pipeline logic. `packages/shared/src/lib/api/context.ts` is **byte-identical to develop** — develop's `resolveRequestContext` also returns `{ container, auth, translate }` with no `selectedOrganizationId`. `routeHelpers.ts`'s +5 is an unrelated ACL constant; the `organizationId: ctx.selectedOrganizationId ?? null` line is unchanged. **So Finding 1's root (notifications never carry an org) is pre-existing framework behavior, not introduced by the push stack.**

**Phases 5 / 6 are additive feature phases, not fixes for these bugs** (the stack: Phase 1 devices → Phase 2 notifications → Phase 3 rails → **Phase 4 adapters = the layer under test here** → Phase 5 → Phase 6):
- **Phase 5:** silent push + flexible payload + `nonOptOut` types. Touches the strategy for *feature* gating only. Does **not** touch `context.ts`, the worker credential scope, or decryption.
- **Phase 6:** per-device locale + admin custom send + hygiene. **Does not** modify `context.ts`/`routeHelpers` (generic notifications org path untouched), nor the worker's `organizationId ?? job.tenantId` credential-scope line, nor `encryption/find.ts`. It **does** add `POST /api/push_notifications/custom-send`, whose route derives `organizationId = scope?.selectedId ?? auth.orgId ?? null` and calls `notificationService.create(input, { tenantId, organizationId })` — i.e. the **admin custom-send path scopes org correctly** and sidesteps Finding 1. Phase 6 tests also assert org-scoped credential resolution (`scope = { tenantId, organizationId: 'org-1' }`), which passes precisely because that path keeps org non-null.

**Synthesis — Findings 1 & 2 share one root cause:** the whole delivery pipeline is org-scoped and works **when the org is present** (proven by Phase 6's admin path + tests). It breaks only when a notification is created **without** an org — which is exactly what the generic `POST /api/notifications` route does today (and what event-driven push, e.g. `messages.new`/`orders.shipped` subscribers, will do). Fixing org propagation at `resolveRequestContext`/`routeHelpers` makes both the strategy device-match (Finding 1) and the worker credential-scope (Finding 2, whose `?? job.tenantId` fallback then never triggers) correct. **Finding 3 (decryption-on-read) is independent** and must be confirmed as code bug vs. encryption-map registration gap in this runtime.

**Bottom line:** our Phase 4 adapter code is **complete and correct** (direct `firebase-admin` send delivered a visible push). The e2e pipeline failure is **not** something missing from Phases 5/6 — it is the pre-existing generic-notifications org gap plus the new Phase-3 rails inheriting it, and (separately) the decryption-on-read symptom.

## Test coverage added

- `packages/core/src/modules/notifications/lib/__tests__/routeHelpers-org-scoping.test.ts` — pins the fix at the layer it lives on: `resolveNotificationContext` inherits `auth.orgId` when nothing is explicitly selected, prefers an explicitly selected org, and stays tenant-level (`null`) only when the caller has no org.
- `packages/core/src/modules/push_notifications/lib/__tests__/push-delivery-org-scoping.test.ts` — filter-aware `em.find` proving the strategy delivers when the notification org matches the org-scoped device, and (correctly) does **not** fan a tenant-level (`org=null`) notification out to an org-scoped device. The suite deliberately asserts there is no strategy-level org fallback: the fix lives at the route/context layer, and a fallback inside the strategy would silently mask any future org-propagation regression.

Both suites pass: `yarn workspace @open-mercato/core test -- routeHelpers-org-scoping push-delivery-org-scoping` → 2 suites, 5 tests green.
