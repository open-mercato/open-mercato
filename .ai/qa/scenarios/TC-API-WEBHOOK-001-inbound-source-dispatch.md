# Test Scenario 001: Inbound Webhook Source Dispatch

## Test ID
TC-API-WEBHOOK-001

## Category
API - Webhooks (Inbound)

## Priority
High

## Type
API Test

## Description
Validates the source-first resolution path of the unified inbound endpoint
`POST /api/webhooks/inbound/[endpointId]` added in Phase 1 (inbound webhook handlers).
A registered webhook source must verify credentials, deduplicate by message id,
persist an ingestion, enqueue dispatch, and emit `webhooks.inbound.received`. Unknown
segments must still fall back to the legacy adapter path (404 when neither resolves).

## Prerequisites
- App running against a tenant DB with the Phase 1 migration applied
  (`webhook_ingestions`, `webhook_inbound_configs`, plus the dedup `webhook_inbound_receipts`).
- A webhook source registered under a known key (e.g. `test_source`) via a module-root
  `webhook-sources.ts` (auto-discovered through `webhooks.sources`). Its `verifier`
  accepts a known signature header and rejects everything else.
- An **active** `InboundEndpointConfig` row for `sourceKey="test_source"` scoped to a
  known `{ organizationId, tenantId }`, with credentials resolvable through
  `integrationCredentialsService` under integration id `webhook_source_test_source`.
- `QUEUE_STRATEGY=local` so the dispatch job runs inline for assertion.

## Test Steps
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | POST `/api/webhooks/inbound/does-not-exist` with any JSON body | Response `404` with `error="Webhook endpoint not found"` |
| 2 | POST `/api/webhooks/inbound/test_source` with a body but a **wrong/missing** signature header | Response `401` with `error="Signature verification failed"` (no ingestion row created) |
| 3 | POST `/api/webhooks/inbound/test_source` with a **valid** signature and `webhook-id: msg-001` | Response `200` with `{ ok: true }` |
| 4 | Inspect `webhook_ingestions` for `source_key="test_source"` | One row: `external_message_id="msg-001"`, `status="received"`, payload/headers stored, scoped to the config's org/tenant |
| 5 | Confirm dispatch + event side effects | `webhook-inbound-dispatch` job ran (handler(s) invoked); `webhooks.inbound.received` emitted once |
| 6 | POST `/api/webhooks/inbound/test_source` again with the **same** `webhook-id: msg-001` | Response `200` with `{ ok: true, duplicate: true }`; no second ingestion row, no re-dispatch |

## Expected Results
- Source resolution takes precedence over the legacy adapter for a registered key.
- Failed verification is rejected with `401` and produces no ingestion/receipt side effects.
- A verified, first-seen message is ingested, dispatched once, and announced via
  `webhooks.inbound.received`.
- Replay of the same message id is deduplicated at the receipt layer and short-circuits
  to `{ ok: true, duplicate: true }` without re-running handlers.

## Edge Cases / Error Scenarios
- No `webhook-id`/`svix-id` header → message id is derived from
  `providerKey:endpointId[:timestamp]:body` (a content change yields a new id; an identical
  body replays as a duplicate).
- More than 60 requests/60s for the same `endpointId`+client IP → `429` (rate limited).
- A registered source whose verifier throws is treated as verification failure (`401`),
  never a `500`.
- One handler throwing during dispatch must not block sibling handlers
  (`webhooks.inbound.handler_failed` emitted; others still run).
