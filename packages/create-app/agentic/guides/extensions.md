# Unified Module Extensions and Overrides

Use the smallest extension mechanism that preserves installed-module ownership. Resolve host IDs from generated facts or exact installed source; never invent spot, route, or entity IDs.

## Mechanism Selector

| Goal | Mechanism | App module file |
|---|---|---|
| Add computed/read data | Response enricher | `data/enrichers.ts` |
| Rewrite/validate request or augment response | API interceptor | `api/interceptors.ts` |
| Block/rewrite a mutation with post-success work | Mutation guard widget/contract | widget injection + guard metadata |
| Add form fields/table columns/actions/filters/toolbar | Headless widget injection | `widgets/injection/**`, `widgets/injection-table.ts` |
| Add/reorder menu items | Headless menu widget | same widget files, `menu:*` host |
| Render a card/tab/section in another page | UI widget injection | same widget files |
| Add app data linked to installed entity | Entity extension | `data/extensions.ts` |
| React after lifecycle change | Typed subscriber | `subscribers/*.ts` |
| Replace/wrap/transform component props | Component override | `widgets/components.ts` |
| Disable/replace route, page, event, worker, widget, agent/tool, setup, ACL, DI, or encryption contract | Unified module entry override | `src/modules.ts` `entry.overrides` |
| Own unsupported installed internals | Eject, only after decision gate | `om-eject-and-customize` |

## Response Enrichers

- Target the exact host entity token and namespace additive output under the app module.
- Implement `enrichMany` for lists to avoid N+1 queries; filter all reads by tenant and organization.
- Declare feature gates, timeout, fallback, priority, and criticality. Fail closed for security decisions; keep decorative enrichment non-critical.
- Opt into cache-on-list-hit only when output is record-pure and invalidated with the host record.
- The host route must enable enrichers for the same entity ID. Run `yarn generate` after adding the file.

## API Interceptors

- Target exact route ID/methods and preserve host auth/scope. A before hook returns schema-compatible body/query; the host validates again.
- Narrow ID lists by intersecting with existing filters. Reject malformed IDs; never convert a bad restriction into unrestricted results.
- Preserve required response keys; make additive changes by default. Time-bound external work and define fallback behavior.
- Custom routes require their explicit interceptor bridge; do not assume all handlers execute generic hooks.

## Mutation Guards

- Map the host operation to create/update/delete (state-changing actions usually update).
- Receive authenticated scope and wildcard-aware feature context. Return an explicit block or a validated modified payload.
- Run post-success callbacks only after commit; callback failure must be logged without pretending the committed write failed.
- Preserve optimistic locking and command side effects. A guard cannot authorize a caller denied by the host.

## Widget Injection

- Map stable widget IDs to exact host spots with `InjectionPosition` for deterministic order.
- Use headless payloads for fields, columns, row/bulk actions, filters, toolbar items, and menus; do not mount React solely to return declarations.
- Preserve host `entityId`/`extensionTableId`; injected actions use guarded/scoped API calls and shared states.
- For editable injected fields, implement all three paths: render/input, read/enricher, and save/interceptor or command. Test save/reload/clear.
- Gate display and execution separately. UI hiding never substitutes for backend authorization.

Common host families include `crud-form:<entityId>:fields`, `data-table:<tableId>:columns`, `:row-actions`, `:bulk-actions`, `:filters`, `:toolbar`, `:search-trailing`, and `menu:sidebar:*`/`menu:topbar:*`. Resolve the concrete IDs; do not derive them by guess.

## Extensions and Optional Coupling

- Keep extension data in a separate app-owned entity with scalar host ID and full tenant/org scope.
- Use a unique scoped key where one extension row per host is expected. Define deletion/orphan and absent-host behavior.
- Use ID plus snapshot when historical rendering must survive host removal/change.
- The optional consumer owns event/enricher/widget glue and guarded DI resolution. The host never imports the optional consumer.

## Component and Module Overrides

- Prefer props transform, then wrapper, then full replacement. Preserve the component's public props and accessibility behavior.
- Use handle-based component targets and stable override keys from facts/source.
- In `src/modules.ts`, `null` disables a supported contract and a value replaces it. Keep override IDs aligned with the replaced value.
- Add a route/page replacement only once; verify generated registries select it and that disabling leaves no stale nav/cache entry.
- Use AI extensions for small prompt/tool/suggestion changes; use full AI overrides only for replacement/disable.

## Feature Toggles

- Define one server-resolved toggle and use it consistently in backend behavior, page/menu/widget visibility, workers/subscribers, and APIs.
- When disabled, choose and test an explicit outcome: hidden, 404/403, no-op, or degraded read. Never leave UI-only gating around a live mutation.

## Verification

1. Test host present and optional host absent.
2. Test authorized, unauthorized, and wildcard-feature callers.
3. Test list and detail, create/update/delete/action, cache hit/miss, and failure fallback where applicable.
4. Run `yarn generate`, inspect host registration, and verify no installed file changed.
