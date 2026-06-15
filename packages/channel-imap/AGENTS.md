# `@open-mercato/channel-imap` — Agent Guidelines

IMAP + SMTP email channel provider for the Communications Hub (`communication_channels`). Connects any IMAP-capable mailbox (Fastmail, Proton Bridge, generic IMAP host) for inbound polling and outbound SMTP delivery.

- **Package**: `@open-mercato/channel-imap` ⇒ **module id**: `channel_imap`
- **Provider key**: `imap` (registered in the hub's channel adapter registry)
- This is an integration provider package — keep all IMAP/SMTP-specific logic here. Do NOT add it to `packages/core`.

## Key Files (`src/modules/channel_imap/`)

| File | Purpose |
|------|---------|
| `integration.ts` | `IntegrationDefinition` (IMAP/SMTP credential fields, `healthCheck.service`, detail widget spot) |
| `di.ts` | `register(container)` — registers the adapter AND `channelImapHealthCheck` under the exact `healthCheck.service` name |
| `setup.ts` | Registers the adapter at import time; declares `defaultRoleFeatures` |
| `acl.ts` | `channel_imap.view`, `channel_imap.configure` |
| `lib/adapter.ts` | `ImapChannelAdapter` — implements the `ChannelAdapter` contract |
| `lib/credentials.ts` | Zod schemas: IMAP/SMTP credentials (+ SSRF host guard) + channel sync state |
| `lib/validate-credentials.ts` | Live LOGIN validation; rejects cleartext transport by default (M5) |
| `lib/imap-client.ts` | `ImapClient` (`imapflow`-backed); `credentialsToConnection(credentials)` |
| `lib/smtp-client.ts` | `SmtpClient` (`nodemailer`-backed); `credentialsToSmtpConnection(credentials)` |
| `lib/health.ts` | `channelImapHealthCheck` liveness probe (real IMAP LOGIN) |
| `lib/convert-outbound.ts` / `lib/normalize-inbound.ts` | RFC2822 outbound build / inbound MIME normalization |
| `lib/capabilities.ts` | `ChannelCapabilities` (`realtimePush: false`) |

## Adapter Contract

`lib/adapter.ts` implements `ChannelAdapter` from `@open-mercato/core/modules/communication_channels/lib/adapter`. Key methods: `sendMessage`, `normalizeInbound`, `convertOutbound`, `validateCredentials`, `fetchHistory`, `importHistory`, `resolveContact`.

- Credentials are a plain IMAP/SMTP blob on `IntegrationCredentials` (per-user scoped). No OAuth.
- `fetchHistory` is cursor-driven via UIDVALIDITY + UIDNEXT on `channelState`. Bootstrap persists the cursor and fetches zero messages; backlog import is explicit via `importHistory`. Each poll is bounded by `HARD_CAP` (`hasMore: true` re-enqueues).
- The clients are swappable via `setImapClient` / `setSmtpClient` (test-only hooks).

## Security Rules (MUST)

- **Reject cleartext transport.** `imapTls`/`smtpTls: 'none'` is rejected by `validateImapCredentials` unless `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT` is truthy. STARTTLS/implicit TLS always allowed.
- **SSRF guard.** Host strings are attacker-controlled; `credentials.ts` rejects private/loopback hosts unless `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS` is truthy.
- Never log credential values.

## Health Check

`lib/health.ts` exports `channelImapHealthCheck`, registered in `di.ts` under the name declared in `integration.ts` (`healthCheck.service`). IMAP credentials carry everything needed for a real probe, so it does a cheap IMAP LOGIN (`connectAndValidate`) and skips the SMTP round-trip to stay within the hub's 10s budget. Invalid creds or a failed LOGIN ⇒ `unhealthy`.

## Env Vars

| Var | Default | Purpose |
|-----|---------|---------|
| `OM_CHANNEL_IMAP_ALLOW_INSECURE_TRANSPORT` | `false` | Permit `'none'` (cleartext) TLS mode in credential validation |
| `OM_CHANNEL_IMAP_ALLOW_INTERNAL_HOSTS` | `false` | Permit private/loopback IMAP/SMTP hosts (bypasses SSRF guard) |
| `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL` | `200` | Max UIDs fetched per `fetchHistory` poll |

## After Changes

- Run `yarn generate` after adding/modifying module files (DI, setup, acl, integration).
- Run unit tests: `yarn test` (jest specs live under `lib/__tests__/`).
- If you change the `healthCheck.service` name, update both `integration.ts` AND `di.ts` so the hub can resolve it.
