# Integration and Provider Engineering

Build provider-owned modules around generic integration, data-sync, webhook, queue, and progress contracts. Never place provider-specific behavior inside a generic host module.

## Provider Family Selector

| Family | Primary contract |
|---|---|
| Transactional email | `IntegrationDefinition`, tenant credentials, DI sender + health services, retry/redaction, and app activation. There is no installed generic transactional-email adapter contract. |
| Mailbox/email channel | Installed `communication_channels` hub plus its `ChannelAdapter`, per-user credentials, inbound/outbound conversion, polling/push, health, DI/setup registration. Follow the Gmail/IMAP precedent. |
| Shipping/carrier | Provider package, service/quote/label/tracking adapter, webhook mapping, idempotent fulfillment updates. |
| Payment gateway | Installed `GatewayAdapter`; `registerGatewayAdapter`, `registerWebhookHandler`, and `registerPaymentGatewayDescriptor`; idempotency keys, signed webhooks, concurrency-safe state machine. |
| Commerce/ERP sync | `DataSyncAdapter`, mappings/presets, external IDs, cursors, reconciliation, progress. |
| Generic webhook | Standard signing/verification, replay protection, delivery queue/log/status, scoped configuration. |
| File import/export | Streaming parser/writer, format adapter, progress, cleanup, row errors, formula neutralization. |
| Storage/media | Provider adapter, scoped object keys, signed access, metadata, cleanup and lifecycle. |

## Package and Activation

- In this standalone repository, put an app-specific provider under `src/modules/<provider>/` and activate it through `src/modules.ts`. Do not invent a `packages/*` workspace: the scaffold has no workspace topology.
- When the user explicitly needs reuse across applications, build a separately published provider package/repository with compatible peer/runtime dependencies, public exports, build/prepack output, and module discovery files; install its packed artifact as an app dependency.
- Ask before changing repository topology or adding the production dependency. Keep packed-consumer validation on the reusable-package branch only.
- Register provider services through DI and use an `integration.ts` definition for credentials, health, versions, bundle membership, and detail-page extension spot.
- A provider implementation is not complete when only a transport/client exists. The production path includes `index.ts`, `integration.ts`, `di.ts`, the typed host adapter where one exists, `setup.ts`/`acl.ts` when bootstrap or features are needed, and `src/modules.ts` activation.
- Enable the local module or installed package in `src/modules.ts`. For the reusable branch, test the published/packed artifact, not only package source.
- Keep provider env names prefixed and stable. Apply optional deployment presets from provider-owned `setup.ts` through normal services, with an idempotent rerun CLI when practical.
- Do not preconfigure a provider from core/app bootstrap unless the provider package owns that code.

## Credentials and Security

- Store credentials through the integrations credential service/encryption maps; never log raw values or return secrets to list/detail APIs.
- Declare the host credential/mapping scope. Thread `userId` on every per-user read/write. Tenant-wide credentials or scheduled jobs may use the installed contract's explicit tenant scope (including `organizationId: null`), but must never read or mutate organization-owned rows without deriving and checking an organization for that item.
- Validate external base URLs against SSRF rules, including redirects and DNS/private ranges. Permit private endpoints only through an explicit development setting.
- Redact authorization headers, tokens, signed URLs, provider payload secrets, and sensitive response bodies from errors and logs.
- Use `createLogger` from `@open-mercato/shared/lib/logger` with structured fields; never use raw `console.*` or place credentials/provider payload bodies in log fields.
- Verify inbound signatures against the raw body, enforce timestamp/replay bounds, and atomically claim each inbox delivery before side effects so duplicate callbacks have one winner (`atomic-inbox-claim`).

## Reliability Contract

- Define timeouts, bounded retries with jitter, provider rate-limit handling, circuit/health behavior, and structured logs with correlation IDs.
- Give every remote mutation a durable idempotency key tied to the local operation. Preserve it across transaction rollback/retry.
- Separate transport success from domain reconciliation. Persist external IDs and snapshots only after the relevant durable local/remote boundary succeeds.
- Treat provider variants (site/store/currency/price scope, API version, feature availability) as explicit capability/config branches; do not infer one global shape.
- Keep webhook, poll, manual retry, and scheduled sync paths convergent and safe when they race.

## Data Sync and Cursor Safety

- Implement/register a `DataSyncAdapter` with direction, supported entities, streaming import/export, connection validation, mappings, and cursor support.
- Run sync through queue workers and `ProgressJob`; prevent overlapping runs for the same scoped provider/entity/direction unless explicitly supported.
- Isolate item errors and continue safe batches; report row/item outcomes. A batch transport failure must not advance its cursor.
- Persist a cursor only after the page/batch and its external-ID mappings commit. Retry resumes from the last successful cursor.
- Make reruns idempotent and add reconciliation for provider-side totals/status that may differ from event payloads.
- Preserve nested snapshots/variants required for later mapping; avoid stale payload assumptions by validating versioned contracts.

## Import and Export

- Stream large inputs/outputs; bound memory and file sizes. Validate content type, extension, encoding, column mapping, and row schemas.
- Neutralize spreadsheet formulas in exported untrusted values. Avoid zip/path traversal and clean temporary/artifact files in `finally`/retention jobs.
- Use deterministic locale/timezone/decimal/date handling and return row-level errors without exposing secrets.
- Support cancellation and progress; perform domain writes through commands.

## Provider UI and UMES

- Use integrations/settings pages and provider detail widget spots rather than cloning the marketplace UI.
- Gate credential, health, mapping, sync, and log actions with their own features. Use shared guarded mutations and states.
- Add external IDs/status to domain pages through enrichers/widgets, keeping host modules unaware of the provider.
- Use typed events and notifications for completion/failure; use DOM Event Bridge/progress for live status instead of aggressive polling.

## Email Routing

- First decide whether the request is **transactional delivery** or a **connected mailbox**. SMTP used only for application-generated mail is a transactional provider: register its `IntegrationDefinition`, encrypted credentials, DI sender/health services, and app module, but do not claim it implements a mailbox contract that the installed framework does not expose.
- Gmail, IMAP/SMTP mailboxes, inbox sync, threading, history, or per-user send/receive belong to the installed `communication_channels` module. Implement `ChannelAdapter` from `@open-mercato/core/modules/communication_channels/lib/adapter`, set `integration.hub: 'communication_channels'`, register the adapter and exact `healthCheck.service` in `di.ts`, ensure idempotent adapter registration/default grants in `setup.ts`, and activate both the hub and provider in `src/modules.ts`.
- Use the installed `channel_gmail` and `channel_imap` facts/source as precedent. Thread `userId` on every mailbox credential read/write; tenant-wide transactional credentials must not read per-user rows.

## Testing

1. Use a contract server/mock for normal, timeout, rate-limit, malformed, partial, retry, duplicate, signature, and pagination responses.
2. Verify credential redaction, SSRF rejection, scope isolation, per-user separation, and webhook replay behavior.
3. Verify a rerun produces no duplicate remote/local records and concurrent callbacks converge.
4. Inject a page/batch failure and prove the cursor did not advance or lose data.
5. Pack/build the provider and run generation/typecheck/tests from a standalone consumer.
