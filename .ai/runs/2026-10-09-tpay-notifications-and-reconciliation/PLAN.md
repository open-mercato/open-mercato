# Execution Plan — Tpay notifications and reconciliation

- **Date:** 2026-10-09
- **Slug:** tpay-notifications-and-reconciliation
- **Source specs:** `.ai/specs/2026-07-26-tpay-full-integration.md`, `.ai/specs/2026-08-01-tpay-status-reconciliation.md`
- **Pre-implementation analysis:** `.ai/specs/analysis/ANALYSIS-2026-07-26-tpay-notifications-and-reconciliation.md`
- **Base branch:** `develop` (stacked on fork PR #1 `mtytula/tpay-spec-implementation` and fork PR #2 `mtytula/payment-gateway-webhook-extensions`)
- **Branch:** `mtytula/tpay-notifications` (fork remote; PR in `mtytula/open-mercato`)

## Tasks

> Authoritative status table. `Status` is `todo` or `done`; `Commit` is filled by the following commit. First non-`done` row is the resume point. Step ids and `Exec` cells are immutable.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add Tpay notification form parsing and MD5 checksum | dispatch | done | dcab00283 |
| 1 | 1.2 | Add Tpay JWS verification with bundled per-environment trust anchors | dispatch:capable | done | c69590e84 |
| 1 | 1.3 | Add the Tpay notification handler and webhook registration | dispatch:capable | done | f6058f8f7 |
| 1 | 1.4 | Document Tpay notifications and update the notification spec | inline | done | 50d4d0c76 |
| 2 | 2.1 | Add the Tpay status reconciliation worker | dispatch | done | f4729c6eb |
| 2 | 2.2 | Register the Tpay reconciliation schedule on setup and integration state changes | dispatch:capable | done | self |
| 2 | 2.3 | Document Tpay reconciliation and update the reconciliation spec | inline | todo | — |

## Goal

Settle Tpay payments from signed server notifications on the generic webhook route and repair missed notifications with a scheduled status poll, keeping everything inside `packages/gateway-tpay`.

## Scope

- `packages/gateway-tpay`: notification libs (form, MD5, JWS + certificates), handler, `di.ts` registration, worker, subscriber, setup hook, locales, tests.
- Docs: user guide, specs, run folder.

## Non-goals

- Shared/core changes (all generic hooks exist from fork PR #2).
- A session locator via `tr_id` (transaction title) — follow-up if `GET /transactions/{title}` is confirmed.
- Live sandbox acceptance (needs a public HTTPS tunnel; done with the user).
- Refunds, EUR, cards/tokenization.

## Risks

- JWS chain/CN validation mistakes → tests use a generated test CA plus the real bundled anchors for chain-shape checks.
- Ambiguity when one payment id has several Tpay transactions → handler narrows by signed amount; residual same-amount retries fail closed (`400 FALSE`), recovered by reconciliation.
- Scheduler ownership rules → provider-owned worker id/queue; tests assert ids.

## External References

Tpay notifications docs `https://docs-api.tpay.com/en/webhooks/`; certificates `https://secure.tpay.com/x509/*`, `https://secure.sandbox.tpay.com/x509/*`.

## Implementation Plan

### Phase 1 — Notification settlement

#### 1.1 Add Tpay notification form parsing and MD5 checksum

- `lib/notification-form.ts`: decode a `Buffer` with `new TextDecoder('utf-8', { fatal: true })` (throw → invalid), parse `URLSearchParams`, reject duplicate keys for `id, tr_id, tr_date, tr_crc, tr_amount, tr_paid, tr_status, md5sum, tr_currency`, require `id, tr_id, tr_date, tr_crc, tr_amount, tr_paid, tr_desc, tr_status, tr_error, tr_email, md5sum, test_mode`; bound lengths (e.g. 256 chars per field, `md5sum` exactly 32 hex); `tr_amount`/`tr_paid` canonical decimals (`^\d+(\.\d{1,2})?$`) parsed to integer grosze without floats; `tr_crc` UUID; optional `tr_currency` (uppercased) must be `PLN` when present; `tr_status` lowercased must be `true` or `chargeback`. Returns a typed object; errors are `[internal]` with a stable reason code, no field values.
- `lib/checksum.ts`: `computeTpayMd5({ id, trId, trAmount, trCrc, securityCode })` lowercase hex over the decoded lexical values; `verifyTpayMd5(expected, actual)` via `crypto.timingSafeEqual` on equal-length buffers.
- Tests: valid fixture, each missing field, duplicate security field, invalid UTF-8, bad amount formats (`1,00`, `1.001`, `-1`), non-PLN currency, unknown status, case-insensitive status, MD5 known vector (compute with node crypto in test), timing-safe mismatch/length mismatch.

#### 1.2 Add Tpay JWS verification with bundled per-environment trust anchors

- `lib/certificates/`: commit the two reviewed PEM bundles as TS string constants (`production`: `KIP SA HA CA` + `KIP SA Root CA` from `https://secure.tpay.com/x509/tpay-jws-root.pem`; `sandbox`: `KIP SA Sandbox CA` + `KIP SA Root CA` from `https://secure.sandbox.tpay.com/x509/tpay-jws-root.pem`), with expected leaf CN and exact `x5u` per environment.
- `lib/jws.ts`: `verifyTpayJws({ header: string, rawBody: Buffer, environment, fetchCertificate? })`:
  - 3 segments, empty middle segment, protected header base64url JSON with `alg === 'RS256'` and `x5u` exactly equal to the environment URL;
  - certificate fetch: HTTPS GET with `redirect: 'error'`, 5 s timeout, 64 KiB cap; parse with `crypto.X509Certificate`; validate validity dates, leaf CN, `leaf.verify(intermediate.publicKey)` and `intermediate.verify(root.publicKey)` and root self-signed matches bundled root;
  - cache verified leaf per environment for min(1 h, notAfter); on signature failure with a cached leaf, refetch once; negative-cache fetch failure 30 s;
  - verify `RSA-SHA256` over `${protectedB64}.${base64url(rawBody)}` with the leaf public key;
  - invalid evidence → throw a verification error; fetch/timeout/oversize → throw `WebhookVerificationUnavailableError` (from `@open-mercato/shared/modules/payment_gateways/types`).
- Tests: generate a test CA/intermediate/leaf with node crypto (or fixture PEMs generated at test time) injected via an overridable anchor set; valid signature; altered body; wrong alg; non-empty payload segment; wrong x5u (host, path, query, http); expired leaf; wrong CN; chain mismatch; fetch timeout/oversize/redirect → unavailable; cache hit, refresh-once on failure, negative cache. Plus a test that the bundled production and sandbox anchors parse and chain (intermediate verifies with root).

#### 1.3 Add the Tpay notification handler and webhook registration

- `lib/webhook-handler.ts`: `verifyTpayNotification(input: VerifyWebhookInput)`: requires `Buffer` rawBody, `x-jws-signature` header, credentials (`environment`, `notificationSecurityCode` required — missing → verification failure); parse form (1.1); `candidate` required and `candidate.paymentId === tr_crc`; MD5 then JWS (1.2); amount checks: `tr_amount` grosze === snapshot amount grosze (parse stored numeric string, e.g. `"12.3400"`), currency PLN/absent and equal to snapshot; for `true`: `tr_paid >= tr_amount` (underpayment → failure); returns `WebhookEvent` `{ eventType: 'tpay.transaction.settled' | 'tpay.transaction.chargeback', eventId: `${tr_id}:${status}:${tr_date}`, idempotencyKey: `tpay:transaction:${tr_id}:${status}:${tr_date}`, data: { status: 'correct' | 'refund', title, trDate, paid, amount, testMode }, timestamp }`. Overpayment: settle, include `overpaidBy` grosze in data. No logging of body/email/signature.
- `lib/webhook-response.ts`: `formatTpayWebhookResponse(outcome)`: `accepted` → 200 `TRUE`; `no_candidate`, `verification_unavailable`, `processing_failed` → 503 `FALSE`; `verification_failed` → 400 `FALSE`; `payload_too_large` → 413 `FALSE`; `rate_limited` → 429 `FALSE`; all `text/plain; charset=utf-8`.
- `di.ts`: `registerWebhookHandler('tpay', verifyTpayNotification, { readPaymentIdHint: (_payload, context) => tr_crc from the raw form (no throw on bad input → null), rawBody: 'bytes', maxBodyBytes: 64 * 1024, formatResponse: formatTpayWebhookResponse })`. Adapter `verifyWebhook` delegates to the same function.
- Tests: handler happy path (settled + chargeback), MD5 fail, JWS fail, missing security code, payment id mismatch, amount mismatch, underpayment, overpayment data, non-PLN, deterministic identity for duplicates, no PII in event data; formatter table; registration options (bytes, limit, locator returns tr_crc / null for garbage).

#### 1.4 Document Tpay notifications and update the notification spec

- User guide: notification setup (Merchant Panel URL or `notificationUrl`, security code required, sandbox vs production certificates, no redirects, ports), behaviour table, troubleshooting.
- Spec: implementation notes + status `in-progress` until sandbox acceptance; changelog.

### Phase 2 — Status reconciliation

#### 2.1 Add the Tpay status reconciliation worker

- `workers/status-poller.ts` in `gateway_tpay`: metadata `{ queue: 'gateway-tpay-status-poller', id: 'gateway_tpay:status-poller', concurrency: 2 }`; handler reads `scope.{organizationId,tenantId}` (or top-level `organizationId/tenantId`) from the scheduler payload, `limit` (default 100, max 100); resolves `paymentGatewayService` from DI; `listTransactionsForStatusPolling({ providerKey: 'tpay', organizationId, tenantId, limit })`; `getPaymentStatus(tx.id, scope)` per transaction with per-item try/catch (log + `reportError` code `gateway_tpay.status_poll_failed`); structured summary log `{ scanned, changed, failed }`. Missing scope → no-op + warn.
- Tests: scope required, providerKey forced to `tpay`, limit clamp, per-item failure isolation, summary counts.

#### 2.2 Register the Tpay reconciliation schedule on setup and integration state changes

- `lib/reconciliation-schedule.ts`: `syncTpayReconciliationSchedule({ container, scope, enabled })` → if no `schedulerService` registration: skip; else `register({ id: stableScheduleUuid(`gateway_tpay:status-poller:${tenantId}:${organizationId}`) (reuse the helper used by payment_gateways setup — import or replicate per module-boundary rules), name, scopeType: 'organization', organizationId, tenantId, scheduleType: 'interval', scheduleValue: '5m', targetType: 'queue', targetQueue: 'gateway-tpay-status-poller', targetPayload: { limit: 100 }, sourceType: 'module', sourceModule: 'gateway_tpay', isEnabled: enabled, description })`.
- `subscribers/integration-state-updated.ts`: on `integrations.state.updated` with `integrationId === 'gateway_tpay'` → sync with `isEnabled`; idempotent; errors logged + `reportError`.
- `setup.ts` `seedDefaults`: for the setup scope, if `integrationStateService.isEnabled('gateway_tpay', scope)` → sync enabled.
- Tests: stable id across calls, exact registration fields, disabled sync, missing scheduler skip, subscriber filters other integrations, seedDefaults only when enabled. Verify the worker id prefix equals `sourceModule` (scheduler ownership rule).

#### 2.3 Document Tpay reconciliation and update the reconciliation spec

- User guide section (what it does, cadence, enable/disable, rollback); spec implementation notes + status; run `yarn generate` check that worker/subscriber are discovered.
