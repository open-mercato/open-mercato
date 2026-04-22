# Webhooks Package — Agent Guidelines

Use `@open-mercato/webhooks` for Standard Webhooks delivery, inbound verification, and webhook marketplace/admin flows.

## MUST Rules

1. **MUST use the shared webhook primitives** — import signing, verification, and secret helpers from `@open-mercato/shared/lib/webhooks`
2. **MUST enqueue outbound deliveries** — never send webhook HTTP requests directly from subscribers or API routes unless the endpoint is the explicit synchronous test route
3. **MUST keep workers and subscribers idempotent** — delivery jobs, retries, and inbound processing may run more than once
4. **MUST scope every entity query by `tenantId` and `organizationId`** — webhook config and delivery logs are tenant data
5. **MUST use `findWithDecryption` / `findOneWithDecryption`** for webhook secret reads — secrets are encrypted fields
6. **MUST update both canonical and aliased API surfaces carefully** — `/api/webhooks/...` is the contract surface; compatibility aliases must keep working when present
7. **MUST wire backend UI writes through shared CRUD helpers or guarded mutations** — do not add ad hoc fetch logic for create, update, retry, rotate, or test actions
8. **MUST treat inbound adapters as provider-owned** — register `WebhookEndpointAdapter` in the provider module; do not hardcode provider behavior in the webhooks package

## When You Need Outbound Webhooks

1. Declare or reuse the source event in the emitting module's `events.ts`
2. Match outbound subscriptions in `subscribers/outbound-dispatch.ts`
3. Create the delivery record through `createWebhookDelivery()`
4. Enqueue work through `enqueueWebhookDelivery()` from `lib/queue.ts`
5. Process HTTP delivery only in `workers/webhook-delivery.ts` / `processWebhookDeliveryJob()`
6. Emit lifecycle events (`webhooks.delivery.*`) when delivery state changes
7. Test with `QUEUE_STRATEGY=local` and `QUEUE_STRATEGY=async` when you change queue behavior

## When You Need Inbound Webhooks

1. Implement a provider-local `WebhookEndpointAdapter`
2. Register it with `registerWebhookEndpointAdapter()` from `lib/adapter-registry.ts`
3. Verify signatures inside the adapter, not in the route
4. Return `tenantId` and `organizationId` from the adapter whenever the provider can resolve them
5. Let `api/inbound/[endpointId]/route.ts` handle rate limiting, deduplication, and event emission
6. Keep provider-specific business logic in `adapter.processInbound()`
7. Add unit coverage for adapter verification and inbound processing behavior

## When You Need Admin UI Changes

1. Keep webhook list/detail/create flows under `src/modules/webhooks/backend/webhooks/`
2. Reuse `CrudForm`, `DataTable`, `FormHeader`, `RowActions`, and shared notices from `@open-mercato/ui`
3. Keep delivery logs and retry/test actions aligned with `webhooks.delivery.*` lifecycle states
4. Update integration marketplace widgets in `widgets/injection/` when webhook integration settings or aggregated logs change
5. Add i18n keys in all webhook locale files when you add user-facing strings

## Structure

```text
packages/webhooks/src/modules/webhooks/
├── api/                  # Webhook CRUD, deliveries, inbound receiver, test/rotate/retry routes
├── backend/webhooks/     # Admin pages for list, detail, create, secret reveal
├── data/                 # Entities and validators
├── lib/                  # Delivery engine, queue helper, adapter registry, integration settings/state
├── subscribers/          # Outbound dispatch, inbound processing, failure notifications
├── workers/              # Delivery queue worker
├── widgets/              # Integration detail page tabs and injected UI
└── events.ts             # Webhook lifecycle events
```

## Checklist: Adding a New Delivery Capability

1. Add or update the contract in `.ai/specs/SPEC-057-2026-03-04-webhooks-module.md` if behavior changes materially
2. Modify shared types or helpers in `packages/shared/src/lib/webhooks/` first when the contract changes
3. Add or update webhook package code in `lib/`, `api/`, `subscribers/`, or `workers/`
4. Run `yarn generate` if you add module files that rely on auto-discovery
5. Run `yarn workspace @open-mercato/webhooks test`
6. Run `yarn workspace @open-mercato/webhooks build`

## Cross-Reference

- **Queue worker contract**: `packages/queue/AGENTS.md`
- **Event subscribers and persistent delivery**: `packages/events/AGENTS.md`
- **Backend forms, tables, and detail pages**: `packages/ui/AGENTS.md`
- **Integration marketplace tabs, settings, and logs**: `packages/core/src/modules/integrations/AGENTS.md`
- **Webhook spec and phase tracking**: `.ai/specs/SPEC-057-2026-03-04-webhooks-module.md`
