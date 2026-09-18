# `@open-mercato/channel-expo` — Agent Guidelines

Expo push provider for the Communications Hub (`communication_channels`). Registers a `push` `ChannelAdapter` (providerKey `expo`) consumed by the `push_notifications` delivery strategy/worker.

- **Package**: `@open-mercato/channel-expo` ⇒ **module id**: `channel_expo`
- **Provider key**: `expo` · **channelType**: `push`
- Transport: `expo-server-sdk` (Expo push service) — keep all Expo-specific logic here.

## Key Files (`src/modules/channel_expo/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (credentials field, `healthCheck.service`) |
| `di.ts` / `setup.ts` | Register the adapter + `channelExpoHealthCheck`; `defaultRoleFeatures` |
| `acl.ts` | `channel_expo.view`, `channel_expo.configure` |
| `lib/adapter.ts` | `ExpoChannelAdapter`; `setExpoClientFactory` test seam isolates expo-server-sdk |
| `lib/credentials.ts` | Zod schema: `{ accessToken? }` |
| `lib/health.ts` | `channelExpoHealthCheck` liveness probe |

## Adapter Contract

Implements the shared push-adapter contract (see `channel-fcm` AGENTS.md). A malformed Expo token (`!Expo.isExpoPushToken`) and a `DeviceNotRegistered` ticket both map to the uniform `device_unregistered` sentinel so the worker soft-deletes the device. Receipt-polling for delayed `DeviceNotRegistered` is out of scope — classification is on the send ticket.

## Credentials

Tenant-level credentials on `IntegrationCredentials` for provider `channel_expo`: `{ accessToken? }` (only needed with Expo enhanced push security). Connect via the existing `communication_channels` credentials-connect flow. Device tokens (`ExponentPushToken[...]`) live in `devices.UserDevice.push_token`, never here.
