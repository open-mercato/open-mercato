# Unified Override Domains

Load this reference when `src/modules.ts` must disable or replace an installed contribution. `entry.overrides` is the only canonical app-level override umbrella. Resolve every key from generated facts or exact installed context; `null` disables a supported contribution and a typed value replaces it.

| Domain | Shape/key |
|---|---|
| AI agents/tools | `overrides.ai.agents`, `overrides.ai.tools` — agent ID/tool name |
| API routes | `overrides.routes.api` — `METHOD /api/path` |
| Backend/frontend pages | `overrides.routes.pages` — `/backend/...` or `/frontend/...` |
| Event subscribers | `overrides.events.subscribers` — subscriber ID |
| Workers | `overrides.workers` — `<module>:<worker-id>` |
| Injection widgets | `overrides.widgets.injection` — widget ID |
| Component overrides | `overrides.widgets.components` — component handle |
| Dashboard widgets | `overrides.widgets.dashboard` — widget ID |
| Notification types/handlers | `overrides.notifications.types`, `.handlers` — stable ID |
| API interceptors | `overrides.interceptors` — interceptor ID |
| Command interceptors | `overrides.commandInterceptors` — interceptor ID |
| Response enrichers | `overrides.enrichers` — enricher ID |
| Page guards/middleware | `overrides.guards` — middleware ID |
| CLI commands | `overrides.cli` — command string |
| Setup hooks | `overrides.setup` — module ID/typed setup shape |
| ACL features | `overrides.acl.features` — feature ID |
| DI bindings | `overrides.di` — container key |
| Encryption maps | `overrides.encryption.maps` — entity ID |

## Rules

- Apply the override to the entry for the module that owns the contribution. Do not add a competing route/widget/worker and hope load order wins.
- API route methods are case-insensitive and paths normalize a leading/trailing slash; use the canonical displayed key. Disabling all methods removes the route entry.
- Page keys name generated frontend/backend URL paths, not filesystem paths. After hiding a landing page, provide a safe accessible redirect.
- Preserve replacement type/signature, auth/features, scope, stable ID, and observable side effects. A replacement may strengthen safety but never silently narrow a public contract.
- Treat unknown/stale override diagnostics as failures. Run `yarn generate`, clear structural nav/module caches with the app's documented command, and verify the old contribution is absent in every bootstrap.
- Verify host present/absent, wildcard ACL, direct URL/API access, registry uniqueness, cache/navigation cleanup, and rollback to the base contribution.

For additive behavior use an enricher, interceptor, guard, widget/menu, extension entity, event subscriber, or component wrapper instead of replacing the whole contribution.
