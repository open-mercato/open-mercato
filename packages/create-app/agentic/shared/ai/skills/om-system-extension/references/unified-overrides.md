# Unified Override Domains

Load this reference when `src/modules.ts` must disable or replace an installed contribution. `entry.overrides` is the only canonical app-level override umbrella. Resolve every key from generated facts or exact installed context. For keyed override maps, `null` disables a supported contribution and a typed value replaces it; AI extensions and setup hooks have the special shapes below.

| Domain | Shape/key |
|---|---|
| AI agents/tools | `overrides.ai.agents`, `overrides.ai.tools` — agent ID/tool name |
| Additive AI extensions | `overrides.ai.extensions` — ordered `AiAgentExtension[]`; additive array, not a key-to-`null` replacement map |
| API routes | `overrides.routes.api` — `METHOD /api/path` |
| Backend/frontend pages | `overrides.routes.pages` — `/backend/...` or `/frontend/...` |
| Event subscribers | `overrides.events.subscribers` — subscriber ID |
| Workers | `overrides.workers` — resolved `ModuleWorker.id`; explicit `metadata.id` wins, otherwise generated fallback `<module>:workers:<path>` |
| Injection widgets | `overrides.widgets.injection` — generated registry `entry.key` |
| Component overrides | `overrides.widgets.components` — component handle |
| Dashboard widgets | `overrides.widgets.dashboard` — generated registry `entry.key` |
| Notification types/handlers | `overrides.notifications.types`, `.handlers` — stable ID |
| API interceptors | `overrides.interceptors` — interceptor ID |
| Command interceptors | `overrides.commandInterceptors` — interceptor ID |
| Response enrichers | `overrides.enrichers` — enricher ID |
| Page guards/middleware | `overrides.guards` — middleware ID |
| CLI commands | `overrides.cli` — command string |
| Setup hooks | `overrides.setup` — entry-scoped `defaultRoleFeatures`, `defaultCustomerRoleFeatures`, `seedDefaults`, `seedExamples`, `onTenantCreated`; hook booleans use `false` to disable |
| ACL features | `overrides.acl.features` — feature ID |
| DI bindings | `overrides.di` — container key |
| Encryption maps | `overrides.encryption.maps` — entity ID |

## Rules

- A global override map may be declared on an app override entry; it need not impersonate the module that originally contributed the keyed contract. Setup is entry-scoped. Do not add a competing route/widget/worker and hope load order wins.
- API route methods are case-insensitive and paths normalize a leading/trailing slash; use the canonical displayed key. Disabling all methods removes the route entry.
- Page keys name generated frontend/backend URL paths, not filesystem paths. After hiding a landing page, provide a safe accessible redirect.
- Injection/dashboard keys are generated entry keys and may differ from widget metadata IDs. Worker keys are resolved descriptor IDs; inspect generated facts/source instead of constructing them from memory.
- Keep AI extensions additive and ordered. Use agent/tool maps only for replacement or disable; do not encode an extension as a `null`-capable map entry.
- Preserve replacement type/signature, auth/features, scope, stable ID, and observable side effects. A replacement may strengthen safety but never silently narrow a public contract.
- Treat unknown/stale override diagnostics as failures. Run `yarn generate`, clear structural nav/module caches with the app's documented command, and verify the old contribution is absent in every bootstrap.
- Verify host present/absent, wildcard ACL, direct URL/API access, registry uniqueness, cache/navigation cleanup, and rollback to the base contribution.

For additive behavior use an enricher, interceptor, guard, widget/menu, extension entity, event subscriber, or component wrapper instead of replacing the whole contribution.
