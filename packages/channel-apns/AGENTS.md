# `@open-mercato/channel-apns` — Agent Guidelines

Apple Push Notification service provider for the Communications Hub (`communication_channels`). Registers a `push` `ChannelAdapter` (providerKey `apns`) consumed by the `push_notifications` delivery strategy/worker.

- **Package**: `@open-mercato/channel-apns` ⇒ **module id**: `channel_apns`
- **Provider key**: `apns` · **channelType**: `push`
- Transport: `@parse/node-apn` (native HTTP/2, token-based `.p8` auth) — keep all APNs-specific logic here.

## Transitive `node-forge` pin

`@parse/node-apn@6.5.0` declares `node-forge` as an **exact** version (`node-forge: "npm:1.3.1"`), not a range, so a normal install can never pick up a patched `node-forge` — even one published to fix a vulnerability. The root `package.json` therefore carries a `resolutions` entry lifting the whole monorepo to `node-forge@1.4.0`, alongside the other security-hygiene pins in that block.

Do not remove the pin while this package depends on `@parse/node-apn`: dropping it silently reverts every workspace to the exact 1.3.1 the SDK hard-codes. It can be dropped once `@parse/node-apn` relaxes the constraint to a caret range, or once this package moves off that transport. `yarn why node-forge` confirms the pin is applied.

## Key Files (`src/modules/channel_apns/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (credentials fields, `healthCheck.service`) |
| `di.ts` / `setup.ts` | Register the adapter + `channelApnsHealthCheck`; `defaultRoleFeatures` |
| `acl.ts` | `channel_apns.view`, `channel_apns.configure` |
| `lib/adapter.ts` | `ApnsChannelAdapter`; `setApnsSenderFactory` test seam isolates `@parse/node-apn` |
| `lib/credentials.ts` | Zod schema: `{ p8Key, keyId, teamId, bundleId, production? }` |
| `lib/health.ts` | `channelApnsHealthCheck` liveness probe |

## Adapter Contract

Implements the shared push-adapter contract (see `channel-fcm` AGENTS.md). Permanent-token reasons mapped to the uniform `device_unregistered` sentinel: `Unregistered` (410), `BadDeviceToken` (400). One HTTP/2 `apn.Provider` is cached per credentials hash. The `ApnsSender` seam keeps the node-apn provider out of the control flow and out of unit tests.

## Credentials

Tenant-level credentials on `IntegrationCredentials` for provider `channel_apns`: `{ p8Key (PEM contents), keyId, teamId, bundleId (APNs topic), production }`. Connect via the existing `communication_channels` credentials-connect flow. Device tokens live in `devices.UserDevice.push_token`, never here.
