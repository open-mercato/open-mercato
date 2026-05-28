# `@open-mercato/channel-microsoft` — Agent Guidelines

Microsoft 365 / Outlook email channel provider for the Communications Hub (`communication_channels`). Connects per-user accounts via Azure AD OAuth2 + PKCE. Outbound uses Graph `/me/sendMail`; inbound uses Graph mail-folders delta query (polling by default, optional change-notification push).

- **Package**: `@open-mercato/channel-microsoft` ⇒ **module id**: `channel_microsoft`
- **Provider key**: `microsoft` (registered in the hub's channel adapter registry)
- This is an integration provider package — keep all Microsoft-specific logic here. Do NOT add it to `packages/core`.

## Key Files (`src/modules/channel_microsoft/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (credential fields, `healthCheck.service`, detail widget spot) |
| `di.ts` | `register(container)` — registers the adapter AND `channelMicrosoftHealthCheck` under the exact `healthCheck.service` name |
| `setup.ts` | Registers the adapter at import time; declares `defaultRoleFeatures` |
| `acl.ts` | `channel_microsoft.view`, `channel_microsoft.configure` |
| `lib/adapter.ts` | `MicrosoftChannelAdapter` — implements the `ChannelAdapter` contract |
| `lib/credentials.ts` | Zod schemas: Azure AD app config + per-user tokens + channel sync state; `resolveAuthority` |
| `lib/oauth.ts` | `MicrosoftOAuthClient` (authorize URL, code exchange, refresh, PKCE, id_token claims) |
| `lib/graph-client.ts` | `GraphApiClient` (inbox delta, message MIME, sendMail, subscriptions) |
| `lib/health.ts` | `channelMicrosoftHealthCheck` liveness probe |
| `lib/convert-outbound.ts` / `lib/normalize-inbound.ts` | Graph outbound build / inbound MIME normalization |
| `lib/capabilities.ts` | `ChannelCapabilities` |

## Adapter Contract

`lib/adapter.ts` implements `ChannelAdapter` from `@open-mercato/core/modules/communication_channels/lib/adapter`. Key methods: `sendMessage`, `normalizeInbound`, `convertOutbound`, `buildOAuthAuthorizeUrl`, `exchangeOAuthCode`, `refreshCredentials`, `fetchHistory`, `registerPush`/`unregisterPush`/`applyPushNotification`, `deleteMessage`, `resolveContact`.

- Tenant Azure AD app config (`{ clientId, tenantId?, clientSecret?, scopes? }`) lives on `IntegrationCredentials` for provider `microsoft`; per-user tokens live on `CommunicationChannel.credentials`. Public PKCE clients omit `clientSecret`; confidential clients provide it.
- `fetchHistory` is cursor-driven via Graph `deltaLink` on `channelState`; a `410 Gone` falls back to a fresh delta. Mid-drain pages pin `pendingNextLink` without advancing `deltaLink`.
- The clients are swappable via `setGraphApiClient` / `setMicrosoftOAuthClient` (test-only hooks).

## Health Check

`lib/health.ts` exports `channelMicrosoftHealthCheck`, registered in `di.ts` under the name declared in `integration.ts` (`healthCheck.service`). The hub passes the tenant-scoped app config (no access token at this layer), so the probe validates it against `microsoftClientCredentialsSchema` rather than calling Graph. A missing/invalid `clientId` ⇒ `unhealthy`; a valid public client (no secret) is still `healthy`.

## Env Vars

| Var | Purpose |
|-----|---------|
| `OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS` | Lead time before a Graph subscription expires when scheduling renewal (push delivery) |

## After Changes

- Run `yarn generate` after adding/modifying module files (DI, setup, acl, integration).
- Run unit tests: `yarn test` (jest specs live under `lib/__tests__/`).
- If you change the `healthCheck.service` name, update both `integration.ts` AND `di.ts` so the hub can resolve it.
