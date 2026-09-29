# Tpay Scheduled Payment Status Reconciliation

- **Status:** planned
- **Date:** 2026-08-01
- **Type:** OSS payment-provider recovery capability
- **Provider package:** `@open-mercato/gateway-tpay` (`gateway_tpay`)
- **Technical dependency:** `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`
- **Rollout prerequisite:** `.ai/specs/2026-07-26-tpay-full-integration.md`

## TLDR

Schedule the existing generic payment-gateway status poller for Tpay every five minutes so missed or delayed notifications cannot leave eligible transactions pending indefinitely. The capability adds no worker, route, schema, or payment state machine; it registers a provider- and tenant-scoped schedule and adds the observability and tests needed to operate it safely.

## Overview

Authoritative server notifications are the primary Tpay settlement path, but delivery and certificate dependencies can fail. Open Mercato already has a bounded `payment-gateways-status-poller` worker that queries eligible transactions through `PaymentGatewayService.listTransactionsForStatusPolling` and calls the canonical `getPaymentStatus` path for each result.

The missing capability is schedule registration for Tpay scopes plus provider-specific operational evidence. Reusing the generic worker avoids provider-to-core ORM coupling and keeps polling transitions identical to return-page and notification transitions.

## Problem Statement

A verified payment can remain locally `pending` when Tpay exhausts notification retries, certificate delivery is unavailable, or an operator initially misconfigures the callback URL. A provider-local worker would duplicate status filtering, transaction scoping, event emission, error isolation, and connection-budget controls. The solution must activate the existing worker without creating a competing settlement path.

## Proposed Solution

`gateway_tpay` adds an idempotent `setup.seedDefaults` registration with the existing scheduler service:

- stable schedule ID derived from `gateway_tpay:status-poller:<tenantId>:<organizationId>`;
- organization scope and the setup-provided tenant/organization IDs;
- interval of five minutes in UTC;
- target queue `payment-gateways-status-poller`;
- target payload `{ scope: { providerKey: 'tpay', organizationId, tenantId }, limit: 100 }`;
- enabled only when the Tpay integration is configured for that scope;
- safely skipped when `schedulerService` is unavailable, matching existing module setup patterns.

Repeated setup and overlapping deploys update/reuse the same schedule rather than registering duplicates. Disabling Tpay stops new sessions but keeps the adapter available until in-flight transactions are terminal; operators may then disable the reconciliation schedule.

## Architecture

```text
gateway_tpay setup
  -> existing schedulerService registration
  -> payment-gateways-status-poller queue every five minutes
  -> existing status-poller worker (concurrency 2)
  -> PaymentGatewayService.listTransactionsForStatusPolling
  -> provider adapter getStatus
  -> canonical getPaymentStatus transition/events
```

The provider package never queries `GatewayTransaction` directly and does not import core module internals. The schedule payload scopes the generic service query; individual transaction scope is always copied from each stored transaction before polling.

Worker behavior remains unchanged:

- eligible unified statuses are the generic worker's existing `pending`, `authorized`, and `partially_captured` set;
- results are ordered oldest `updatedAt` first and limited to 100;
- worker concurrency stays 2 within the process DB connection budget;
- a transient provider failure is isolated and logged per transaction so the rest of the batch continues;
- the next scheduled run retries non-terminal transactions.

No provider-specific backoff, dead-letter queue, freshness column, or second status worker is introduced.

## Data Models

No schema change or backfill is required. The generic worker uses existing transaction status, `updatedAt`, `lastPolledAt`, provider key, and tenant/organization fields. Schedule persistence is owned by the existing scheduler service.

No PII, credential, raw provider response, or payer data is added to the schedule payload or reconciliation metrics.

## API Contracts

There is no new public route or user-triggered command. The only new runtime contract is the scheduler registration targeting the existing queue with:

```text
scope.providerKey = tpay
scope.organizationId = <setup organization>
scope.tenantId = <setup tenant>
limit = 100
```

Scope values come from trusted module setup, never from a public request. Status lookup continues through the Tpay adapter contract from `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`.

## Internationalization

No interactive text is added. Operator documentation uses existing `gateway_tpay` locale/help conventions. Structured internal failures do not become user-facing provider error text.

## UI/UX

No UI-rendering file changes. Existing transaction detail and payment status screens reflect the canonical lifecycle event after a repair. The implementation PR qualifies for `skip-qa` only when it changes no UI/API/database contract and includes the automated reconciliation coverage below.

## Edge Cases & Failure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Setup runs repeatedly | One stable schedule remains for the tenant/organization scope. |
| Scheduler service is unavailable | Setup completes without failing tenant creation; health/operations report reconciliation unavailable. |
| Two organizations use Tpay | Each schedule queries only its stored organization and tenant scope. |
| Provider API fails for one transaction | Log the scoped failure and continue the remaining batch. |
| A transaction becomes terminal during an overlapping run | Canonical service/idempotency behavior prevents an invalid duplicate transition. |
| More than 100 eligible transactions exist | Poll the oldest 100; later runs drain the backlog gradually. |
| Tpay is disabled with pending transactions | Keep adapter/schedule available until in-flight transactions are terminal or manually resolved. |
| Transaction stays pending for 30 minutes | Emit pending-age alert with scope-safe identifiers for operator investigation. |

## Rollout and Operations

1. Land and enable authoritative Tpay notification settlement first.
2. Register the reconciliation schedule in sandbox and verify stable repeated setup.
3. Suppress a sandbox notification and prove polling repairs the transaction.
4. Enable for one production tenant and observe a full schedule cycle before broader rollout.
5. Keep the schedule enabled permanently as a recovery path.

Rollback unregisters or disables only the Tpay schedule. It does not disable notifications, return-page status reads, or the Tpay adapter.

Required counters and gauges:

- reconciliation runs, scanned, repaired, unchanged, and failed;
- provider request latency and error class;
- eligible backlog size and oldest pending age;
- schedule registration/update failure.

Alert on repeated reconciliation-run failure, oldest pending age above 30 minutes, or a sustained backlog that does not decrease.

## Testing Strategy and Acceptance Criteria

All tests create their own tenant, organization, credentials, payment, and transaction fixtures and clean them up in `finally`. Provider HTTP responses are deterministic fixtures.

| Surface | Required coverage |
| --- | --- |
| Setup | Stable ID, exact interval/queue/payload, repeated registration, missing scheduler, and two-scope isolation. |
| Selection | Provider, tenant, and organization filters; eligible status set; oldest-first order; limit 100. |
| Processing | Canonical `getPaymentStatus`, terminal transition, unchanged pending status, and lifecycle event emission. |
| Resilience | One provider failure does not abort the batch; next run retries; overlapping runs do not create invalid effects. |
| Operations | Counters exclude PII/secrets and pending-age alert uses scoped identifiers. |

Acceptance requires a missed-notification sandbox transaction to reach `captured` through the scheduled generic poller, with one canonical captured event, no duplicate schedule after repeated setup, and no transaction read outside its tenant/organization scope.

## Out of Scope and Follow-up Specifications

- Hosted PLN session creation and `getPaymentStatus`: `.ai/specs/2026-08-01-tpay-hosted-pln-payment-sessions.md`.
- Notification form transport, MD5/JWS verification, and acknowledgement behavior: `.ai/specs/2026-07-26-tpay-full-integration.md`.
- Generic raw locator, payment locator/candidate, body limit, and response formatting: their separate `2026-08-01-payment-gateway-webhook-*` specifications.
- Refund reconciliation. A future refund spec must persist each immutable Tpay `refundId` and poll `GET /refunds/{refundId}`; partial refunds do not use transaction status as identity.
- Dynamic payment methods, direct BLIK, cards, wallets, EUR/POS support, and storefront work.

## Risks & Impact Review

### Cross-tenant polling

- **Scenario:** A schedule or query reads another tenant's transactions.
- **Severity:** Critical
- **Affected area:** Payment state and provider credentials.
- **Mitigation:** Setup-derived scope, provider filter, scoped service query, per-transaction stored scope, and two-tenant integration tests.
- **Residual risk:** A future unscoped manual queue job could bypass setup; worker/service tests must keep optional broad jobs out of provider registration.

### Backlog load

- **Scenario:** Provider outage creates many eligible transactions and repeated API calls.
- **Severity:** Medium
- **Affected area:** Worker DB pool and Tpay quota.
- **Mitigation:** Five-minute cadence, batch 100, oldest-first order, generic concurrency 2, per-item isolation, and backlog alerting.
- **Residual risk:** Large backlogs drain gradually to preserve foreground capacity.

### Competing status transitions

- **Scenario:** A notification, return-page request, and poll overlap.
- **Severity:** Medium
- **Affected area:** One transaction's lifecycle events.
- **Mitigation:** Every path calls the canonical gateway service and existing transition/idempotency behavior; overlap is explicitly tested.
- **Residual risk:** Provider responses may arrive in different orders; terminal-state rules remain owned by the gateway service.

## Migration & Backward Compatibility

- The existing worker, queue name, service signatures, status set, and event IDs are unchanged.
- The new schedule is additive and scoped to Tpay-enabled organizations.
- No schema migration, backfill, public API, UI contract, ACL feature, or tenant action is required.
- Disabling the schedule cleanly restores the previous notification/return-poll behavior.
- If implementation needs a shared/core change beyond existing scheduler and worker contracts, update this specification and run the compatibility review before coding it.

## Implementation Plan

1. Register the stable scoped schedule from `gateway_tpay` setup using a soft scheduler-service dependency.
2. Add setup and generic-worker integration coverage for isolation, ordering, limit, retries, overlap, and canonical events.
3. Add provider-safe metrics, pending-age alerting, and operator documentation for enable/disable/rollback.
4. Validate a sandbox repair with the notification path suppressed.
5. Run `yarn generate`, affected package tests/builds, integration tests, and every configured validation command.

The capability lands in one PR after notification settlement and can be reverted independently.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/integrations/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/events/AGENTS.md`
- `.ai/skills/om-integration-builder/SKILL.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule | Status | Notes |
| --- | --- | --- |
| One independently deployable capability | Compliant | Only scheduled Tpay status reconciliation is specified. |
| No cross-module ORM coupling | Compliant | Provider setup targets the generic worker/service; it never queries core entities. |
| Tenant/organization scope | Compliant | Setup and every poll remain scoped and tested with two tenants. |
| Queue work is bounded and idempotent | Compliant | Existing concurrency, batch, canonical service, and per-item isolation are retained. |
| Integration coverage ships with implementation | Compliant | Schedule, recovery, overlap, and cross-scope cases are acceptance gates. |

### Non-Compliant Items

None identified.

### Verdict

Fully compliant — ready for implementation after authoritative Tpay notification settlement.

## Changelog

### 2026-08-01

- Split scheduled reconciliation from the Tpay notification-settlement capability.
- Defined exact schedule payload, scope, bounds, operations, rollback, and acceptance evidence.
