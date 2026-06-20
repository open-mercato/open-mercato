# `@open-mercato/channel-gmail` — Agent Guidelines

Gmail email channel provider for the Communications Hub (`communication_channels`). Connects per-user Gmail accounts via OAuth2. Outbound uses `gmail.users.messages.send`; inbound uses the History API (polling by default, optional Pub/Sub push).

- **Package**: `@open-mercato/channel-gmail` ⇒ **module id**: `channel_gmail`
- **Provider key**: `gmail` (registered in the hub's channel adapter registry)
- This is an integration provider package — keep all Gmail-specific logic here. Do NOT add it to `packages/core`.

## Key Files (`src/modules/channel_gmail/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (credentials fields, `healthCheck.service`, detail widget spot) |
| `di.ts` | `register(container)` — registers the adapter AND `channelGmailHealthCheck` under the exact `healthCheck.service` name |
| `setup.ts` | Registers the adapter at import time; declares `defaultRoleFeatures` |
| `acl.ts` | `channel_gmail.view`, `channel_gmail.configure` |
| `lib/adapter.ts` | `GmailChannelAdapter` — implements the `ChannelAdapter` contract |
| `lib/credentials.ts` | Zod schemas: OAuth client config + per-user tokens + channel sync state |
| `lib/oauth.ts` | `GoogleOAuthClient` (authorize URL, code exchange, refresh, userinfo) |
| `lib/gmail-client.ts` | `GmailApiClient` (history.list, messages.list/get/send, watch/stop) |
| `lib/health.ts` | `channelGmailHealthCheck` liveness probe |
| `lib/convert-outbound.ts` / `lib/normalize-inbound.ts` | RFC2822 outbound build / inbound MIME normalization |
| `lib/capabilities.ts` | `ChannelCapabilities` (`realtimePush: false`, `deleteMessage: true`) |

## Adapter Contract

`lib/adapter.ts` implements `ChannelAdapter` from `@open-mercato/core/modules/communication_channels/lib/adapter`. Key methods: `sendMessage`, `normalizeInbound`, `convertOutbound`, `buildOAuthAuthorizeUrl`, `exchangeOAuthCode`, `refreshCredentials`, `fetchHistory`, `registerPush`/`unregisterPush`/`applyPushNotification`, `deleteMessage`, `resolveContact`.

- Tenant OAuth client config (`{ clientId, clientSecret, scopes? }`) lives on `IntegrationCredentials` for provider `gmail`; per-user tokens live on `CommunicationChannel.credentials`.
- `fetchHistory` is cursor-driven via `channelState.historyId`. The terminal `historyId` MUST only advance over messages actually normalized; a transient (non-404/410) fetch failure pins the cursor and re-fetches next tick (see the L3 fix in `fetchAndNormalize`).
- The clients are swappable via `setGmailApiClient` / `setGoogleOAuthClient` (test-only hooks).

## Health Check

`lib/health.ts` exports `channelGmailHealthCheck`, registered in `di.ts` under the name declared in `integration.ts` (`healthCheck.service`). The hub passes the tenant-scoped OAuth client config (no access token at this layer), so the probe validates the client config against `gmailClientCredentialsSchema` rather than calling the API. Missing/invalid config ⇒ `unhealthy`.

## Env Vars

| Var | Purpose |
|-----|---------|
| `OM_GMAIL_PUBSUB_TOPIC` | Fully-qualified Pub/Sub topic for `registerPush` (optional; polling works without it) |

## After Changes

- Run `yarn generate` after adding/modifying module files (DI, setup, acl, integration).
- Run unit tests: `yarn test` (jest specs live under `lib/__tests__/`).
- If you change the `healthCheck.service` name, update both `integration.ts` AND `di.ts` so the hub can resolve it.
