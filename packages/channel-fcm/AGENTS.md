# `@open-mercato/channel-fcm` — Agent Guidelines

Firebase Cloud Messaging push provider for the Communications Hub (`communication_channels`). Registers a `push` `ChannelAdapter` (providerKey `fcm`) consumed by the `push_notifications` delivery strategy/worker.

- **Package**: `@open-mercato/channel-fcm` ⇒ **module id**: `channel_fcm`
- **Provider key**: `fcm` · **channelType**: `push`
- Integration provider package — keep all FCM-specific logic here. Do NOT add it to `packages/core`.

## Key Files (`src/modules/channel_fcm/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (credentials fields, `healthCheck.service`) |
| `di.ts` | `register(container)` — registers the adapter AND `channelFcmHealthCheck` |
| `setup.ts` | Registers the adapter at import; `defaultRoleFeatures` |
| `acl.ts` | `channel_fcm.view`, `channel_fcm.configure` |
| `lib/adapter.ts` | `FcmChannelAdapter` — `sendMessage` via firebase-admin; `setFcmMessagingFactory` test seam |
| `lib/credentials.ts` | Zod schema for the service-account JSON credentials |
| `lib/health.ts` | `channelFcmHealthCheck` liveness probe |

## Adapter Contract

Implements the push-adapter contract shared with the `push_stub`, `channel-apns`, and `channel-expo` adapters:
- reads `metadata.pushToken` + the push envelope from `content.raw` (`@open-mercato/core/.../push-envelope`)
- capabilities come from the shared `pushChannelCapabilities` baseline
- a permanently-invalid token returns the **uniform** `device_unregistered` sentinel (`error:'device_unregistered'`, `metadata.unregistered:true`) so the worker soft-deletes the device. FCM codes mapped: `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`. `messaging/invalid-argument` is **deliberately excluded** — FCM returns it for any malformed request field (oversized payload, bad data key), so mapping it would let a single payload-shape bug soft-delete every targeted device tenant-wide; it falls through to the generic retryable `failed` path instead.
- one firebase-admin app is cached per service-account hash (re-init per send is wasteful + errors on duplicate app names).

## Credentials

Tenant-level credentials live on `IntegrationCredentials` for provider `channel_fcm`: `{ serviceAccountJson, appName? }`. Connect via the existing `POST /api/communication_channels/channels/connect/credentials` flow. Per-device tokens live in `devices.UserDevice.push_token`, never here.
