# Module Discovery Surface Catalog

Load this reference when deciding which convention files a complete module needs. It is a routing catalog, not a checklist: create only surfaces required by the brief, then run `yarn generate` after adding, removing, or renaming any discovered surface.

## Ownership and Domain

| Surface | Canonical path | Contract |
|---|---|---|
| Module metadata/dependencies | `index.ts` | Export stable module metadata; optional dependencies degrade safely. |
| Entities and validation | `data/entities.ts`, `data/validators.ts` | App-owned persistence, tenant/org scope, encrypted fields, `updated_at`, validation. |
| Entity links/extensions | `data/extensions.ts` | `EntityExtension[]`; scalar cross-module IDs, never cross-module ORM relations. |
| Custom entities/fields | `ce.ts` | Declare custom entities/field sets with generated entity IDs and DSL helpers. |
| DI and lifecycle | `di.ts`, `setup.ts` | Register services; idempotent tenant hooks/default grants/seeds. |
| ACL and encryption | `acl.ts`, `encryption.ts` | Stable feature IDs and entity encryption maps. |
| Domain writes | `commands/**` | Commands own mutations, guards, transactions, side effects, undo/audit. |
| Command interception | `commands/interceptors.ts` | Cross-cutting command hooks keyed by stable command IDs; preserve command safety. |

## HTTP and Pages

| Surface | Canonical path | Contract |
|---|---|---|
| API | `api/**/route.ts` | Export HTTP handlers, per-method `metadata`, and `openApi`; use factories/commands. |
| API interception | `api/interceptors.ts` | Scoped route/method hooks; custom routes opt into their supported bridge. |
| Backend pages | `backend/**/page.tsx` + `page.meta.ts` | `/backend/...`; staff features, navigation metadata, shared backend UI. |
| Public pages | `frontend/**/page.tsx` + `page.meta.ts` | `/...`; explicit public/auth posture and safe server-derived scope. |
| Customer portal | `frontend/[orgSlug]/portal/**/page.tsx` + `page.meta.ts` | Customer auth/features; `[orgSlug]` first; optional portal `nav`. |
| Page middleware | `backend/middleware.ts`, `frontend/middleware.ts` | Export `PageRouteMiddleware[]`; never use UI visibility as authorization. |

Do not use legacy HTTP-method directories or new flat page files. The installed generator's `page.tsx`/`route.ts` scanner and generated facts are authoritative if an older upstream guide shows a retired convention.

## Events, Async, and Data Presentation

| Surface | Canonical path | Contract |
|---|---|---|
| Typed events | `events.ts` | Stable event IDs and typed payloads. |
| Event subscribers | `subscribers/*.ts` | Default handler plus event metadata; choose persistent/idempotent behavior deliberately. |
| Workers | `workers/*.ts` | Default handler plus queue/id/concurrency metadata; retry-safe and scoped. |
| Workflows | `workflows.ts` | Stable workflow/activity IDs and durable output contracts. |
| Search | `search.ts` | Entity indexing/presentation; cover reindex and convergence. |
| Analytics | `analytics.ts` | Module analytics configuration with scoped aggregates. |
| Translatable fields | `translations.ts` | Entity-field translation declarations; separate from UI locale messages. |
| Response enrichment | `data/enrichers.ts` | Scoped `enrichOne` plus batched `enrichMany`, ACL and cache posture. |
| Mutation guards | `data/guards.ts` | Block/rewrite mutations without bypassing commands, scope, or locking. |
| Cache | module service resolved through cache DI | Tenant-tagged keys and write-path invalidation; no raw provider client. |
| Progress | module jobs/events plus progress APIs | Durable server progress or client-local event progress as appropriate. |

## UI, Communication, and Automation

| Surface | Canonical path | Contract |
|---|---|---|
| Injection widgets | `widgets/injection/**/widget.ts(x)` | Rendered or headless declarations with stable widget IDs. |
| Injection mapping | `widgets/injection-table.ts` | Exact host spot and deterministic placement. |
| Dashboard widgets | `widgets/dashboard/**/widget.ts(x)` | Stable widget ID, scoped data, shared dashboard primitives. |
| Component overrides | `widgets/components.ts` | Stable handles; props/wrapper before replacement. |
| Notification types | `notifications.ts` | Stable notification IDs and payload contracts. |
| Notification UI | `notifications.client.ts`, `widgets/notifications/**` | Lightweight localized renderers. |
| Reactive notification effects | `notifications.handlers.ts` | Feature-gated, wildcard-aware, idempotent browser reactions. |
| Message types/objects | `message-types.ts`, `message-objects.ts` | Stable message/object definitions and supported UI renderers. |
| Inbox actions | `inbox-actions.ts` | Stable action IDs with authorization and guarded execution. |
| AI tools and agents | `ai-tools.ts`, `ai-agents.ts` | Typed IDs, ACL/scope, tool allowlists, approval-gated mutations. |
| CLI | `cli.ts` | Stable commands that work from compiled/published packages. |
| Integration metadata | `integration.ts` | Provider/integration contribution when that subsystem requires it. |
| Generator plugins | `generators.ts` | Additional deterministic generated registries only when necessary. |

Provider-specific conventions live in the integration guide/skill. Payment renderer compatibility may use the installed `widgets/payments/client.ts(x)` contract; inspect the exact installed module before implementing it.

## Completion Probe

1. Map each requested capability to exactly one owning row; mark optional host behavior.
2. Preserve stable IDs across metadata, ACL, entities, routes, events, widgets, messages, agents, and workflows.
3. Run `yarn generate`; inspect the expected registry entry and structural warnings.
4. Run focused unit tests plus self-contained API/UI integration paths for every selected surface.
