# Execution Plan — Inbound Webhook Handlers (Phase 1)

**Run:** 2026-06-17-inbound-webhook-handlers
**Branch:** feat/inbound-webhook-handlers
**Base:** origin/develop
**Source spec:** .ai/specs/2026-03-23-inbound-webhook-handlers.md
**Pre-implement analysis:** .ai/specs/analysis/ANALYSIS-2026-03-23-inbound-webhook-handlers.md

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Bake analysis remediation into the spec; add analysis report | done | 9dcea46a0 |
| 1 | 1.2 | Shared inbound types in @open-mercato/shared | done | e0076c573 |
| 2 | 2.1 | WebhookIngestion entity + IngestionStatus enum + encryption map | done | ef34f53ef |
| 2 | 2.2 | InboundEndpointConfig entity | done | 765265c45 |
| 2 | 2.3 | Migration + snapshot for new inbound tables | done | a29a3ff23 |
| 2 | 2.4 | Add webhooks.inbound.processed / handler_failed events | done | 139a73e4f |
| 3 | 3.1 | Source + handler registries; handler resolution + pattern match (unit tests) | done | 98590a878 |
| 3 | 3.2 | Inbound dispatch worker + queue helper | todo | — |
| 4 | 4.1 | Generator: scan webhook-sources.ts + webhook-handlers/*.ts | todo | — |
| 4 | 4.2 | Generator: process + emit registries; extend Module type; bootstrap + template wiring | todo | — |
| 5 | 5.1 | Unify inbound route: source registry first, adapter fallback | todo | — |
| 5 | 5.2 | Unit tests for unified route resolution / dedup / reject | todo | — |

## Goal

Implement Phase 1 (Core Infrastructure) of the inbound-webhook-handlers spec: a module-level inbound webhook handler convention that mirrors event subscribers, dispatched through a single inbound endpoint, after first correcting the spec per the pre-implement analysis.

## Scope

- Shared inbound types (`@open-mercato/shared/modules/webhooks`).
- `WebhookIngestion` + `InboundEndpointConfig` entities, migration, snapshot, encryption map.
- New events `webhooks.inbound.processed`, `webhooks.inbound.handler_failed`.
- Source registry (`webhook-sources.ts`) + handler registry (`webhook-handlers/*.ts`) runtime, globalThis-backed, with wildcard handler resolution reusing `matchEventPattern`.
- Queue-backed `inbound-dispatch` worker.
- Generator auto-discovery for the two new conventions + additive `Module` type fields + generated registries + bootstrap/template wiring.
- **Unify** the inbound route on the existing `api/inbound/[endpointId]` path: resolve the new source registry first, fall back to the legacy `WebhookEndpointAdapter` registry unchanged.
- Unit tests for resolution, pattern matching, dedup, and signature rejection.

## Non-goals (deferred to later phases)

- Phase 2 admin UI (ingestion log / sources pages, replay).
- Phase 3 Stripe reference handlers (`gateway-stripe` — existence unconfirmed).
- Phase 4 inbox_ops refactor.
- Source credential admin UI / credential schema rendering.
- Outbound-loop `_inboundIngestionId` suppression edit (specced, not implemented in Phase 1).

## Route-collision decision (analysis BC#1)

**Unify on `[endpointId]`.** The shipped `POST /api/webhooks/inbound/[endpointId]` route stays the single entry point. The route resolves the segment against the new `webhookSourceRegistry` first; if no source matches, it falls back to `getWebhookEndpointAdapter()` exactly as today. This preserves the public URL and the legacy adapter contract (BC#2 bridge) with zero behavior change for existing adapters.

## Risks (brief)

- **Generator edits** (`scanner.ts`, `module-registry.ts`, `Module` type, generated registries) are high-blast-radius; land additively, mirror create-app bootstrap, re-run `yarn generate && yarn build:packages && yarn build:app`.
- **Migration/snapshot** churn — prune unrelated generator output; never run `db:migrate`.
- **WebhookIngestion.payload** may carry PII → encrypt `payload`/`headers` via `webhooks/encryption.ts`; read with `findOneWithDecryption`.
- Push target is `origin` (upstream) per user instruction; if write is denied, fall back to `fork` and surface.

## External References

None (`--skill-url` not used).
