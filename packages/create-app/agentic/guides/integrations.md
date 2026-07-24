# Integration and Provider Engineering

Build reusable providers as dedicated packages/modules around generic integration, data-sync, webhook, queue, and progress contracts. Never place provider-specific behavior inside a generic host module.

## Provider Family Selector

| Family | Primary contract |
|---|---|
| Email/mailbox | Integration definition, per-user or tenant credentials, inbound/outbound adapter, health/logging. |
| Shipping/carrier | Provider package, service/quote/label/tracking adapter, webhook mapping, idempotent fulfillment updates. |
| Payment gateway | Provider package, payment/session adapter, idempotency keys, signed webhooks, concurrency-safe state machine. |
| Commerce/ERP sync | `DataSyncAdapter`, mappings/presets, external IDs, cursors, reconciliation, progress. |
| Generic webhook | Standard signing/verification, replay protection, delivery queue/log/status, scoped configuration. |
| File import/export | Streaming parser/writer, format adapter, progress, cleanup, row errors, formula neutralization. |
| Storage/media | Provider adapter, scoped object keys, signed access, metadata, cleanup and lifecycle. |

## Package and Activation

- Use a dedicated workspace/npm package for an external provider. Declare compatible peer/runtime dependencies, public exports, build/prepack output, and module discovery files.
- Register provider services through DI and use an `integration.ts` definition for credentials, health, versions, bundle membership, and detail-page extension spot.
- Enable the package in the consumer dependency set and `src/modules.ts`; test the published/packed artifact, not only workspace source.
- Keep provider env names prefixed and stable. Apply optional deployment presets from provider-owned `setup.ts` through normal services, with an idempotent rerun CLI when practical.
- Do not preconfigure a provider from core/app bootstrap unless the provider package owns that code.

## Credentials and Security

- Store credentials through the integrations credential service/encryption maps; never log raw values or return secrets to list/detail APIs.
- Thread `userId` on every read and write for per-user integrations; omit it consistently for tenant-wide credentials.
- Validate external base URLs against SSRF rules, including redirects and DNS/private ranges. Permit private endpoints only through an explicit development setting.
- Redact authorization headers, tokens, signed URLs, provider payload secrets, and sensitive response bodies from errors and logs.
- Verify inbound signatures against the raw body, enforce timestamp/replay bounds, and make duplicate delivery idempotent.

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

## Testing

1. Use a contract server/mock for normal, timeout, rate-limit, malformed, partial, retry, duplicate, signature, and pagination responses.
2. Verify credential redaction, SSRF rejection, scope isolation, per-user separation, and webhook replay behavior.
3. Verify a rerun produces no duplicate remote/local records and concurrent callbacks converge.
4. Inject a page/batch failure and prove the cursor did not advance or lose data.
5. Pack/build the provider and run generation/typecheck/tests from a standalone consumer.
