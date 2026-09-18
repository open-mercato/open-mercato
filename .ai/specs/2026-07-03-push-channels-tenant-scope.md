# Push-provider channels are tenant-wide (FCM/APNs/Expo)

- Status: implemented
- Date: 2026-07-03
- Modules: `communication_channels`, `channel-fcm`, `channel-apns`, `channel-expo`
- Related: `.ai/specs/2026-04-28-push-notifications-and-devices.md` (push rails),
  `.ai/specs/2026-07-01-push-delivery-e2e-findings.md`

## Problem

Push-provider channels (FCM/APNs/Expo) are shared server infrastructure — a service
account / signing key that serves an entire tenant's devices. The hub's pre-existing
credential-connect path is per-user: it hard-stamps `user_id = auth.sub`. That is wrong
for push: the credential belongs to the tenant, not to whoever clicked connect, and the
connect action should be admin-gated.

The read/delivery side is tenant-wide by design:

- `push_notifications/lib/push-fanout.ts` queries `{ tenantId, channelType:'push', isActive, deletedAt:null }` — no `user_id` filter.
- `push_notifications/lib/push-delivery.ts` resolves credentials at `userId: channel.userId ?? null`.
- `GET /api/communication_channels/channels` (admin list) already filters `user_id IS NULL`.
- `push-delivery.test.ts` models push channels with `user_id: null`.

So a single tenant push channel serves every user's devices; the connect/write path is
the only place tenant scoping has to be enforced.

## Approach

1. **Adapter declares scope.** `ChannelAdapter.channelScope?: 'tenant' | 'user'`
   (absent = `'user'`). `BasePushChannelAdapter` sets `'tenant'`, covering FCM/APNs/Expo
   (and the test stub) in one place. The connect command resolves the adapter, so this is
   the single source of truth for the connect decision — the command never sees the
   decoupled `IntegrationDefinition` (kept in a separate registry, keyed `channel_fcm` vs
   adapter key `fcm`).
2. **Command honors scope.** `connect-credential-channel` computes
   `tenantScoped = adapter.channelScope === 'tenant'` and `effectiveUserId = tenantScoped ? null : input.userId`,
   used for the credential scope, the credential payload (`userId` omitted when null —
   same shape as tenant-wide Stripe/Akeneo credentials), and the channel row. `userId`
   input is `string | null`.
   - **Privilege-escalation guard.** A tenant-scoped provider that arrives with a non-null
     `userId` came from the per-user route (feature `connect_user_channel`, granted to
     manager/employee). The command refuses it (`wrong_scope_for_route` → 403) instead of
     silently minting a privileged tenant-wide channel; the per-user route also
     short-circuits tenant-scoped providers with 403 before dispatch (defense-in-depth).
     The tenant route passes `userId: null`, so legitimate tenant connects still pass.
   - **Org-agnostic scoping.** Tenant-scoped credentials are pinned to `organizationId =
     tenantId` and the channel row is stored with `organization_id = NULL`. The dedup/heal
     key ignores org, and push-delivery reads credentials at `channel.organizationId ?? tenantId`
     = `tenantId`, so a cross-org reconnect (e.g. key rotation from a different org)
     overwrites the one credential row delivery actually reads rather than orphaning it
     under a per-org key.
3. **Push dedup.** `createConnectedChannelRow` gains a heal key for identifier-less push
   channels — `{ tenantId, providerKey, channelType:'push', userId:null }` — so an admin
   reconnect updates the single shared row instead of inserting duplicates. Backed by a new
   partial unique index (below).
4. **Admin route + RBAC.** New feature `communication_channels.connect_tenant_channel`
   (superadmin + admin) and route
   `POST /api/communication_channels/channels/connect/tenant-credentials` which rejects
   non-tenant providers (400 `provider_not_tenant_scoped`) and dispatches the shared command
   with `userId: null`. The per-user route + `connect_user_channel` are untouched.
5. **UI.** Each of `channel-fcm/apns/expo` injects a connect widget (Dialog, modeled on
   `channel-imap`'s) into the shared channels admin DataTable toolbar spot
   `data-table:communication_channels.channels:toolbar`. The host page forwards a `reload`
   through `injectionContext` so a new channel appears without a manual refresh. Push
   providers inject nothing into the profile connect spot, so they never appear on the
   personal page. Strings live under `communication_channels.push.connect.*` (en/de/es/pl).

## Migration & Backward Compatibility

- `ChannelAdapter.channelScope` — ADDITIVE optional field; existing adapters omit it and
  keep per-user behavior. Per `BACKWARD_COMPATIBILITY.md` (types = additive-only).
- Command input `userId` relaxed `uuid()` → `uuid().nullable()` — a relaxation; existing
  callers passing a uuid are unaffected.
- New ACL feature, new API route, new i18n keys, new partial unique index — all additive.
- **New index** `communication_channels_tenant_push_provider_uq`:
  `create unique index … on ("tenant_id","provider_key") where "channel_type" = 'push' and "user_id" is null and "deleted_at" is null`.
  Covers only `user_id IS NULL` rows, so existing per-user rows never violate it. Migration
  `Migration20260703123630_communication_channels.ts` + snapshot updated.
- **`integration_credentials` (`user_id IS NULL`)**: no unique index exists and is not
  added — tenant-wide Stripe/Akeneo credentials already rely on the same find-then-update in
  `credentials-service.ts` `save()`. Push follows that parity.
- **No data upgrade action.** Push ships tenant-scoped from its first release, so
  upgraded installs have no per-user push rows to migrate; any created from a pre-release
  build already serve the whole tenant because fan-out ignores `user_id`. Nulling their
  `user_id` would be cosmetic only, so it is intentionally omitted.

## Integration coverage

- API `POST /api/communication_channels/channels/connect/tenant-credentials`:
  `channel-fcm/__integration__/TC-CHANNEL-PUSH-002.spec.ts` — 422 (tenant-scoped FCM adapter
  reached, empty creds rejected) and 400 (per-user IMAP rejected on the tenant route).
- Unit — route error contract:
  `communication_channels/api/post/channels/connect/tenant-credentials/__tests__/route.test.ts`
  asserts every failure path returns the structured `code` the connect widgets localize on:
  400 `provider_not_tenant_scoped`, 404 unknown provider, 409 `mailbox_already_connected`,
  422 `fieldErrors`, 500 `wrong_scope_for_route`, plus 201 dispatches with `userId: null`.
- Unit — failure-path i18n mapping:
  `communication_channels/lib/__tests__/push-connect-error.test.ts` locks
  `resolvePushConnectErrorMessage` — each route `code` resolves to its
  `push.connect.errors.<code>` locale message (and the key ships in `en.json`), while a
  missing/unknown code falls back to the generic `push.connect.failed`. This is the shared
  helper the three connect widgets call, so the mapping is covered once rather than per
  provider package.
- API `POST /api/communication_channels/channels/connect/credentials` (per-user):
  `TC-CHANNEL-PUSH-001.spec.ts` — FCM (tenant-scoped) is refused with 403
  `provider_is_tenant_scoped` (proves the adapter is registered and the privilege guard holds).
- Unit — command scope: `communication_channels/commands/__tests__/connect-credential-channel.scope.test.ts`
  (tenant adapter → `user_id NULL` channel + credential row even when a user connected;
  per-user adapter keeps `user_id`).
- Unit — dedup: `communication_channels/lib/__tests__/connect-channel.test.ts`
  (tenant push channel created with `user_id NULL`; reconnect heals the same row).
- Read side unchanged; delivery-serves-tenant already covered by
  `push_notifications/lib/__tests__/push-delivery.test.ts`.

## Not changed (deliberate)

`push-fanout.ts`, `push-delivery.ts`, `workers/send-push.worker.ts`, `GET /channels`,
`push-capabilities.ts` — the read/delivery path is already scope-agnostic. Gmail/IMAP stay
per-user (default `channelScope: 'user'`).

## Known tradeoffs

- **Connect-widget duplication.** `ConnectFcmWidget` / `ConnectApnsWidget` / `ConnectExpoWidget`
  are near-identical (~200 lines each) — they differ only in provider key, form fields, and
  defaults; the dialog shell, `update`/`submit`/`onDialogKeyDown`/`Field` and the mutation
  plumbing are copy-pasted. Each lives in its own provider package, so a shared component has no
  natural home (importing UI from one provider package into another couples them). This is an
  accepted tradeoff for now. **Before adding a 4th push provider, extract the shared dialog into
  a reusable helper** (candidate home: a `communication_channels` client export or a small shared
  hook) rather than forking a 4th copy.
- **Failure-path i18n.** The three connect widgets call the shared, React-free
  `resolvePushConnectErrorMessage` (`communication_channels/lib/push-connect-error.ts`), which
  maps the route's structured `body.code` (`provider_not_tenant_scoped`,
  `mailbox_already_connected`, `wrong_scope_for_route`) to
  `communication_channels.push.connect.errors.<code>` keys (en/de/es/pl) and falls back to the
  generic `push.connect.failed`. The raw English `body.error` is reserved for logs/API consumers
  and is never flashed to the admin. A new provider that returns a new `code` MUST add a
  matching `errors.<code>` key in all four locale files, or the generic fallback is shown — the
  helper's unit test guards the shipped codes.

## Post-merge step

Run `yarn mercato auth sync-role-acls` so existing tenants receive the new
`communication_channels.connect_tenant_channel` grant (new tenants get it via `setup.ts`).
