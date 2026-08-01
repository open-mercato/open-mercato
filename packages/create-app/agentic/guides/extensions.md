# Unified Module Extensions and Overrides

Use the smallest extension mechanism that preserves installed-module ownership. Resolve host IDs from generated facts or exact installed source; never invent spot, route, or entity IDs.

## Route Selection

Your file lives in `src/modules/<id>/` either way, so what you change decides the route, not where it lives. Creating your own entity/route/command/page is `module-data`/`backend-ui` alone, even when it calls installed APIs and reads installed facts. Changing an installed module — its records or data derived from them, commands, events, pages, agents, tools, or the invariants applied to them — selects `umes` as well. Reading its facts is not `umes`; changing its behavior is.

Add every other match too: `backend-ui` + `om-backend-ui-design` when authoring, restyling, or ACL-gating a surface this app owns or injected; `module-data` + contracts for app-owned entities/links/routes/commands/ACL; `ai-workflow` for a durable process, activity, or user task; plus the facts of each module involved. Stay `umes`-only when nothing of yours is rendered — hiding, toggling, disabling, rewiring, or auditing a surface an installed module owns.

## Mechanism Selector

| Goal | Mechanism | App module file |
|---|---|---|
| Add computed/read data | Response enricher | `data/enrichers.ts` |
| Rewrite/validate request or augment response | API interceptor | `api/interceptors.ts` |
| Add pre/post command behavior without replacing the command | Command interceptor | `commands/interceptors.ts` |
| Block/rewrite a mutation with post-success work | Mutation guard contract | `data/guards.ts`; add widget injection only for a UI surface |
| Enrich query-engine reads | Query enricher | `data/enrichers.ts` with `queryEngine.enabled` |
| Add form fields/table columns/actions/filters/toolbar | Headless widget injection | `widgets/injection/**`, `widgets/injection-table.ts` |
| Add/reorder menu items | Headless menu widget | same widget files, `menu:*` host |
| Render a card/tab/section in another page | UI widget injection | same widget files |
| Add app data linked to installed entity | Entity extension | `data/extensions.ts` |
| React after lifecycle change | Typed subscriber | `subscribers/*.ts`; `metadata.sync`/`priority` for in-pipeline lifecycle work |
| React to query lifecycle | Sync query subscriber | `subscribers/*.ts` for `*.querying`/`*.queried` |
| React in the browser | Notification handler or DOM bridge | `notifications.handlers.ts`, or `events.ts` with `clientBroadcast` plus UI hooks |
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

## Command Interceptors

- Export `interceptors: CommandInterceptor[]` from `commands/interceptors.ts`. Give each entry a stable `id` and an exact stable `targetCommand`; use module/global wildcards only when the cross-command scope is intentional.
- `beforeExecute` may block with `{ ok: false }` or return a validated shallow `modifiedInput`; `afterExecute` may return additive `modifiedResult` or perform bounded post-success work. `beforeUndo` may block unsafe undo and `afterUndo` performs idempotent cleanup. Preserve metadata only through the documented hook context.
- Feature gates are wildcard-aware. Re-derive tenant/organization ownership from authenticated context or scoped records; an interceptor never grants authority, bypasses the command, suppresses locking/audit/undo, or turns invalid input into a valid-looking unrestricted request.
- Test execute and undo paths, authorized/denied/wildcard callers, safe block/rewrite, hook order, and failure posture. Post hooks must not pretend a committed command failed.

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
- Scope client handlers with `eventHandlers.filter.operations`; use `clientBroadcast`, `useAppEvent`, and `useOperationProgress` for typed real-time behavior instead of polling by default.

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
- The complete wired override catalog spans AI agents/tools/extensions, API/page routes, subscribers, workers, injection/component/dashboard widgets, notification types/handlers, API/command interceptors, enrichers, page guards, CLI, setup, ACL, DI, and encryption. Use `om-system-extension` → `references/unified-overrides.md`; never guess a domain/key.

## Specialized Extension Families

- Integration onboarding/status/detail contributions use the typed integration registry, `InjectionWizard`, `StatusBadgeRenderer`, and provider detail `widgetSpotId`; route to the integration skill as well as UI/UMES.
- Search/vector work includes `search.ts`, `vector.ts`, query enrichers, and query lifecycle subscribers; route to module/data work and inspect exact installed search contracts.
- Embedded AI uses `<AiChat agent="module.agent_id">`; provider/currency/workflow registrations belong to their owning integration or workflow contracts.
- Reactive notification handlers use `notifications.handlers.ts`/`useNotificationEffect`; message/inbox definitions remain stable typed surfaces.

## Feature Toggles

- Define one server-resolved toggle and use it consistently in backend behavior, page/menu/widget visibility, workers/subscribers, and APIs.
- When disabled, choose and test an explicit outcome: hidden, 404/403, no-op, or degraded read. Never leave UI-only gating around a live mutation.

## Verification

1. Test host present and optional host absent.
2. Test authorized, unauthorized, and wildcard-feature callers.
3. Test list and detail, create/update/delete/action, cache hit/miss, and failure fallback where applicable.
4. Run `yarn generate`, inspect host registration, and verify no installed file changed.
