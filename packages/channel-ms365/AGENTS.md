# `@open-mercato/channel-ms365` — Agent Guidelines

Microsoft 365 / Exchange Online email channel provider for the Communications Hub (`communication_channels`). Connects per-user mailboxes via Entra ID OAuth2 (v2.0 endpoints, PKCE). Outbound and inbound both go through Microsoft Graph; inbound uses the Inbox delta query (polling — Graph change notifications are a phase-2 follow-up).

- **Package**: `@open-mercato/channel-ms365` ⇒ **module id**: `channel_ms365`
- **Provider key**: `ms365` (registered in the hub's channel adapter registry)
- **Spec**: `.ai/specs/2026-09-04-ms365-graph-email-channel.md`
- This is an integration provider package — keep all Microsoft-specific logic here. Do NOT add it to `packages/core`.

## Key Files (`src/modules/channel_ms365/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (tenant credential fields: client id / secret / tenant id / scopes, `healthCheck.service`, detail widget spot) |
| `di.ts` | `register(container)` — registers the adapter AND `channelMs365HealthCheck` under the exact `healthCheck.service` name |
| `setup.ts` | Registers the adapter at import time; declares `defaultRoleFeatures` |
| `acl.ts` | `channel_ms365.view`, `channel_ms365.configure` |
| `lib/adapter.ts` | `Ms365ChannelAdapter` — implements the `ChannelAdapter` contract |
| `lib/credentials.ts` | Zod schemas: OAuth client config + per-user tokens + channel sync state; default scopes |
| `lib/oauth.ts` | `MicrosoftOAuthClient` (authorize URL with PKCE, code exchange, refresh, Graph `/me` profile), authority/Graph base-URL helpers |
| `lib/graph-client.ts` | `GraphMailClient` (Inbox delta, list, `$value` MIME, draft-from-MIME, send, move, delete) + `GraphApiError` |
| `lib/convert-outbound.ts` / `lib/normalize-inbound.ts` | RFC2822 outbound build / inbound MIME normalization via the shared `email-mime` helpers |
| `lib/capabilities.ts` | `ChannelCapabilities` (`realtimePush: false`, `deleteMessage: true`) |
| `lib/health.ts` | `channelMs365HealthCheck` (validates the tenant client config) |
| `widgets/injection/connect/` | *Connect Microsoft 365* button on the profile channels page (`useConnectChannel`) |

## Adapter Contract

`lib/adapter.ts` implements `ChannelAdapter` from `@open-mercato/core/modules/communication_channels/lib/adapter`. Key methods: `sendMessage`, `normalizeInbound`, `convertOutbound`, `buildOAuthAuthorizeUrl`, `exchangeOAuthCode`, `refreshCredentials`, `fetchHistory`, `importHistory`, `deleteMessage`, `resolveContact`.

- Tenant OAuth client config (`{ clientId, clientSecret, tenantId?, scopes? }`) lives on `IntegrationCredentials` for provider `ms365` at tenant scope; per-user tokens live on the per-user row. `tenantId` defaults to `organizations` (no personal accounts).
- `fetchHistory` is cursor-driven via `channelState.deltaLink` / `nextLink` plus a `receivedWatermark`. The stored link MUST only advance after every message of a page was normalized; a transient `$value` failure pins the incoming state (`hardFailed`) and the next tick re-reads the same page. `410 Gone` re-bootstraps from the watermark.
- `sendMessage` creates a draft from raw MIME (`POST /me/messages`) and sends it (`/send`) so the authoritative `internetMessageId` is known; a permanent send failure deletes the orphan draft.
- Every Graph call sends `Prefer: IdType="ImmutableId"`; delta/next links are only followed on the configured Graph origin.
- A 401 anywhere surfaces the `requires_reauth` sentinel (never prefix or translate it). Entra rotates refresh tokens — `refreshCredentials` always persists the new one.
- The clients are swappable via `setGraphMailClient` / `setMicrosoftOAuthClient` (test-only hooks).

## Health Check

`lib/health.ts` exports `channelMs365HealthCheck`, registered in `di.ts` under the name declared in `integration.ts` (`healthCheck.service`). The hub passes the tenant-scoped OAuth client config (no access token at this layer), so the probe validates the config against `ms365ClientCredentialsSchema` rather than calling Graph. Missing/invalid config ⇒ `unhealthy`.

## Env Vars (all optional)

| Var | Purpose |
|-----|---------|
| `OM_CHANNEL_MS365_LOGIN_BASE_URL` | Entra authority host override for sovereign clouds (default `https://login.microsoftonline.com`) |
| `OM_CHANNEL_MS365_GRAPH_BASE_URL` | Graph base URL override (default `https://graph.microsoft.com/v1.0`) |
| `OM_CHANNEL_MS365_DELTA_PAGE_SIZE` | Delta/list page size, 1..200 (default 50) |
| `OM_CHANNEL_MS365_REQUEST_TIMEOUT_MS` | Per-request Graph timeout (default 30000) |

## After Changes

- Run `yarn generate` after adding/modifying module files (DI, setup, acl, integration, widgets).
- Run unit tests: `yarn test` (jest specs live under `lib/__tests__/`).
- If you change the `healthCheck.service` name, update both `integration.ts` AND `di.ts` so the hub can resolve it.
