# Pre-Implementation Analysis: Tpay Notification Settlement and Status Reconciliation

- **Specs:** `.ai/specs/2026-07-26-tpay-full-integration.md`, `.ai/specs/2026-08-01-tpay-status-reconciliation.md`
- **Analyzed against:** `mtytula/tpay-notifications` = Tpay hosted sessions (fork PR #1) + webhook extensions (fork PR #2) on `develop` `d75ebf48f`
- **External sources:** Tpay notifications docs (`https://docs-api.tpay.com/en/webhooks/`), Tpay Open API, live sandbox transaction data, Tpay JWS certificates (`secure.tpay.com` and `secure.sandbox.tpay.com`)

## Executive Summary

Both capabilities fit the existing provider package without shared/core changes, but both specs carry assumptions the real systems contradict. Notification settlement assumes `tr_id` equals the stored provider session id and that sandbox notifications use the production certificate; neither holds. Reconciliation assumes a provider module can schedule the core status-poller queue; the scheduler's module-ownership check (#5455) refuses that, drops `scope.providerKey`, and `seedDefaults` does not run for tenants created later. Recommendation: **ready after the spec edits below**; one provider PR covering both.

## Backward Compatibility

No shared/core contract changes. New provider files only (`gateway_tpay` handler, JWS/checksum libs, bundled certificates, worker, subscriber, setup hook). New worker id `gateway_tpay:status-poller`, queue `gateway-tpay-status-poller`, subscriber id, and schedule ids are additive. All 13 surfaces: no violations.

## Findings

### Critical (block implementation as written)

| # | Spec | Finding | Evidence | Resolution |
|---|------|---------|----------|------------|
| C1 | notifications | `tr_id` is the transaction **title** (`TR-…`), not the Open API `transactionId` (ULID) stored as `providerSessionId`. A `tr_id` session locator never matches. | Tpay webhooks docs ("transaction title assigned by the Tpay system"); sandbox panel titles `TR-59GU-…` vs stored `01M4G…`. | Locate by `tr_crc` only (`readPaymentIdHint`, our `hiddenDescription` = payment id). The handler narrows candidates by signed amount and correlation. A session locator via the title is a follow-up once `GET /transactions/{title}` support is confirmed. |
| C2 | notifications | Sandbox notifications are signed by a sandbox certificate: `https://secure.sandbox.tpay.com/x509/notifications-jws.pem` (CN `notification.sandbox.tpay.com`, issuer `KIP SA Sandbox CA`). Production uses `secure.tpay.com` (CN `notification.tpay.com`, issuer `KIP SA HA CA`). Both chain to `KIP SA Root CA`. | Downloaded certificates, `openssl verify` OK for both. | Per-environment exact `x5u` and per-environment bundled trust anchors (intermediate + root from each `tpay-jws-root.pem`); expected leaf CN per environment. |
| C3 | reconciliation | Scheduler module rows must match the target worker id prefix (`canDispatchScheduleQueueTarget`). The core poller id is `payment-gateways:status-poller`, and the source module is `gateway_tpay`, so the schedule is refused. | `packages/scheduler/src/modules/scheduler/lib/safeQueueTargets.ts`; `payment_gateways/workers/status-poller.ts:20`. | Provider-owned worker `gateway_tpay:status-poller` on queue `gateway-tpay-status-poller` that delegates to `paymentGatewayService.listTransactionsForStatusPolling({ providerKey: 'tpay', … })` + `getPaymentStatus` via DI (no ORM access, same per-transaction isolation). |
| C4 | reconciliation | The scheduler strips author `scope` and rebuilds `{ tenantId, organizationId }`, so `scope.providerKey` never reaches a worker. | `execute-schedule.worker.ts:286`, `localSchedulerService.ts:298`. | Provider worker hardcodes `providerKey: 'tpay'`. |
| C5 | reconciliation | `seedDefaults` runs only for `mercato init` / `seed:defaults`; tenants created later never register a schedule. "Enabled only when configured" has no trigger. | `packages/cli/src/mercato.ts:1242,1479-1532`; `integrations.state.updated` emitted by the state API route. | Register or update on `integrations.state.updated` for `gateway_tpay` (enabled → enabled schedule; disabled → disabled schedule), plus `seedDefaults` for organizations where Tpay is already enabled. Stable id `stableScheduleUuid('gateway_tpay:status-poller:<tenant>:<org>')`, `sourceType: 'module'`, `sourceModule: 'gateway_tpay'`. |

### Important

| # | Spec | Finding | Resolution |
|---|------|---------|------------|
| I1 | notifications | `tr_status` documented values are `true` (paid) and `chargeback`, lowercase in docs. | Case-insensitive; `true` → settled (`event.data.status = 'correct'` → `captured` via existing map), `chargeback` → (`'refund'` → `refunded`); anything else rejected (`400 FALSE`) and logged. |
| I2 | notifications | Locales: repo requires en/pl/de/es/ko. | Five catalogs. |
| I3 | notifications | The generic processor maps `event.data.status` with `adapter.mapStatus` and stores `event.data` as provider data. | `event.data` carries only `status`, `title` (`tr_id`), `trDate`, `paid`, `amount`, `testMode`; never `tr_email`, `tr_desc`, card/token fields. |
| I4 | notifications | MD5 when the security code is unset: Tpay uses an empty string. | Require a configured `notificationSecurityCode` for notification settlement (reject with `verification_failed` when missing) — an empty code makes MD5 forgeable by anyone who knows the public fields; JWS still applies. |
| I5 | notifications | "Notification before commit" = no candidate. | Formatter maps `no_candidate` to `503 FALSE` (retryable), matching the spec table. |
| I6 | reconciliation | Counters/gauges: telemetry runtime has no counter instrument. | Structured logs per run (`scanned`, `changed`, `failed`) without PII. |

## Remediation Plan

1. Apply C1–C5 and I1–I6 to both specs (Proposed Solution, API Contracts, Edge Cases, changelog).
2. Implement in one provider PR: notification form/MD5, JWS + bundled anchors, handler + registration, docs; worker, schedule registration (subscriber + seedDefaults), docs.
3. Sandbox acceptance (needs a public HTTPS tunnel, pending user): notification-only capture, tampered MD5/JWS rejection, duplicate idempotency; reconciliation repair with notifications suppressed.

## Recommendation

Ready to implement after the spec edits; sandbox acceptance remains a manual step.
