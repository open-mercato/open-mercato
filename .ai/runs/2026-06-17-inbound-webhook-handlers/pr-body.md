Tracking plan: .ai/runs/2026-06-17-inbound-webhook-handlers/PLAN.md
Tracking run folder: .ai/runs/2026-06-17-inbound-webhook-handlers/
Status: in-progress

## Goal
Implement Phase 1 (Core Infrastructure) of the inbound-webhook-handlers spec — a module-level inbound webhook handler convention that mirrors event subscribers — after first correcting the spec per the pre-implement analysis. Driven by `.ai/specs/2026-03-23-inbound-webhook-handlers.md`.

## What Changed (so far — 6 of 12 steps)
- **Spec remediation** (`.ai/specs/2026-03-23-inbound-webhook-handlers.md` + analysis report): resolved the route-collision (BC#1) by **unifying on the existing `POST /api/webhooks/inbound/[endpointId]` route** (resolve source registry first, fall back to the legacy `WebhookEndpointAdapter`); added a concrete `WebhookEndpointAdapter` deprecation-bridge section; corrected the Phase 4 `inbox_ops` baseline (encrypted per-tenant secret + Svix already exist); fixed the dedup cache TTL to milliseconds; added optional `credentialFields` to `WebhookSourceConfig`; clarified credential/payload encryption.
- **Shared types** (`@open-mercato/shared/lib/webhooks/inbound-types.ts`): `WebhookSourceConfig`, `WebhookHandlerMeta`, `WebhookHandlerPayload`, `WebhookHandlerContext`, `WebhookHandler`, `WebhookHandlerRegistryEntry`, `WebhookHandlerResult`, `WebhookIngestionStatus` (additive, exported via the barrel).
- **Entities** (`webhooks/data/entities.ts`): `WebhookIngestionEntity` (`webhook_ingestions`) + `InboundEndpointConfigEntity` (`webhook_inbound_configs`), both with `updated_at`; `payload`/`headers` added to the webhooks `encryption.ts` map.
- **Events** (`webhooks/events.ts`): `webhooks.inbound.processed`, `webhooks.inbound.handler_failed` (additive).
- **Registries** (`webhooks/lib/inbound-registry.ts`): globalThis-backed source + handler registries with wildcard handler resolution reusing `matchWebhookEventPattern`; unit-tested.

## Tests
- `@open-mercato/webhooks`: 14 suites / 105 tests pass (no regression).
- New `inbound-registry.test.ts`: 8 tests (source resolution, exact/wildcard/prefix event matching, multi-handler, replace-all).
- `@open-mercato/shared` `tsc --noEmit`: clean.

## Backward Compatibility
- All new surfaces are **additive**: new shared types, two new tables, two new event IDs, a new lib module. No existing contract changed.
- The `WebhookEndpointAdapter` interface + registry remain intact; the route-unification (still to land in Step 5.1) preserves the legacy adapter path as the deprecation bridge.

## Remaining (handoff)
Steps 2.3 (migration + snapshot via `yarn generate`), 3.2 (dispatch worker + queue), 4.1/4.2 (generator auto-discovery for `webhook-sources.ts` + `webhook-handlers/*.ts`, additive `Module` type fields, generated registries, bootstrap/template wiring), 5.1/5.2 (unify the route + tests). Then the full gate (incl. integration suites) + ds-guardian.

**Resume with `om-auto-continue-pr <this PR number>`.**

## Progress
See the [Tasks table in the plan](.ai/runs/2026-06-17-inbound-webhook-handlers/PLAN.md#tasks) — authoritative Step-status source.

## Handoff & Notifications
- Live handoff: `.ai/runs/2026-06-17-inbound-webhook-handlers/HANDOFF.md`
- Notifications log: `.ai/runs/2026-06-17-inbound-webhook-handlers/NOTIFY.md`
