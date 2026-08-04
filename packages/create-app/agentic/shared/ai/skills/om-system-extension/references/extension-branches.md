# Extension Branches

Load only the selected branch.

- **Enricher/query enricher:** use the dotted runtime entity ID in `targetEntity` (for example `customers.person`), never the colon-form CRUD/widget host ID; add a namespaced result, scoped batched `enrichMany`, ACL, timeout/fallback, and conservative cache behavior; set `queryEngine.enabled` only for query lifecycle participation.
- **Interceptor:** exact route/method, schema-compatible request rewrite, additive response, timeout/fail posture, no auth/scope weakening.
- **Command interceptor:** `commands/interceptors.ts`; stable `id` + exact `targetCommand`; choose `beforeExecute`/`afterExecute` and `beforeUndo`/`afterUndo` deliberately; wildcard-aware features and trusted scope; block or shallow-rewrite only through documented results; never bypass the command, locking, audit, or undo.
- **Mutation guard:** operation mapping, wildcard features, explicit block/validated rewrite, post-commit callbacks, command/lock preservation.
- **Widget/menu/client handler:** stable widget/item IDs, exact spot, deterministic placement, headless declaration when possible, display plus execution authorization; constrain client reactions with `eventHandlers.filter.operations`.
- **Extension entity:** app-owned scoped table, scalar host ID, scoped uniqueness, orphan/delete behavior, no cross-module ORM relation.
- **Subscriber:** declared event ID, persistent/idempotent decision, optional-host safe resolve, scoped command write, retry test; sync lifecycle work declares `metadata.sync`/`priority`, including `*.querying`/`*.queried` when applicable.
- **Browser reaction:** reactive notifications use `notifications.handlers.ts`/`useNotificationEffect` and keep the visible reaction idempotent (`idempotent-client-side-effect`); general typed real-time events use `clientBroadcast`, `useAppEvent`, or `useOperationProgress` with authorization on the emitting API.
- **Integration UI:** typed definition, wizard, health/status renderer, provider-scoped detail `widgetSpotId`, and deterministic tab/group/stack placement; add the integration and UI skills.
- **Search/vector/AI/domain registry:** use `search.ts`/`vector.ts`, `<AiChat>`, or the typed payment/shipping/currency/workflow contract and route to its specialist procedure.
- **Component override:** stable handle, preserve props/accessibility; prefer transform/wrapper.
- **Module override:** supported domain/key, key/value identity, `null` disable semantics, generation/cache/nav cleanup.

Run `yarn generate` for every discovered branch and verify generated registration selects the intended host exactly once.

## Canonical example source

One compiling contributor per branch, plus the callers that consume it. Open only your branch's row.

| Branch | Exact file |
|---|---|
| Mutation guard bound to entity kind + operations | [`data/guards.ts`](../../../../src/modules/example/data/guards.ts) |
| Response enricher with `enrichMany` batching, `fallback`, timeout, `cacheableOnListHit` | [`data/enrichers.ts`](../../../../src/modules/example/data/enrichers.ts) |
| API interceptors: exact-route and wildcard, rejection, timeout, query rewrite, cross-module `?ids=` narrowing, `after` merge | [`api/interceptors.ts`](../../../../src/modules/example/api/interceptors.ts) |
| Command interceptors: `beforeExecute` → `afterExecute` state hand-off | [`commands/interceptors.ts`](../../../../src/modules/example/commands/interceptors.ts) |
| Hosts this module exposes (`defineModuleExtensionPoints`) | [`extension-points.ts`](../../../../src/modules/example/extension-points.ts) |
| Every supported spot-id shape mapped to widget ids, as one unconditional object literal | [`widgets/injection-table.ts`](../../../../src/modules/example/widgets/injection-table.ts) |
| CrudForm field contribution with an `onSave` upsert | [`widgets/injection/customer-priority-field/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-field/widget.ts) |
| DataTable column reading an enricher accessor path | [`widgets/injection/customer-priority-column/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-column/widget.ts) |
| DataTable server-strategy filter whose `queryParam` the API interceptor consumes | [`widgets/injection/customer-priority-filter/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-filter/widget.ts) |
| DataTable row action with `InjectionPosition` placement | [`widgets/injection/customer-priority-row-action/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-row-action/widget.ts) |
| DataTable bulk action over selected rows | [`widgets/injection/customer-priority-bulk-actions/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-bulk-actions/widget.ts) |
| Menu items with `labelKey`, feature gating, `Last`/`Before` placement | [`widgets/injection/example-menus/widget.ts`](../../../../src/modules/example/widgets/injection/example-menus/widget.ts), [`widgets/injection/example-profile-menu/widget.ts`](../../../../src/modules/example/widgets/injection/example-profile-menu/widget.ts) |
| Rendered widget: data-only registration + focused client leaf | [`widgets/injection/customer-priority-detail/widget.ts`](../../../../src/modules/example/widgets/injection/customer-priority-detail/widget.ts) |
| Subscribers: before-create rewrite, before-update rejection with status, non-blocking after-delete, ephemeral DI-resolved | [`subscribers/auto-default-priority.ts`](../../../../src/modules/example/subscribers/auto-default-priority.ts), [`subscribers/prevent-uncomplete.ts`](../../../../src/modules/example/subscribers/prevent-uncomplete.ts), [`subscribers/audit-delete.ts`](../../../../src/modules/example/subscribers/audit-delete.ts), [`subscribers/example-event.ts`](../../../../src/modules/example/subscribers/example-event.ts) |
| Browser reaction: reactive handler + client renderer | [`notifications.handlers.ts`](../../../../src/modules/example/notifications.handlers.ts), [`notifications.client.ts`](../../../../src/modules/example/notifications.client.ts) |

[`widgets/components.ts`](../../../../src/modules/example/widgets/components.ts) is marked `qa-only`: it demonstrates `wrapper` mode only, so `replacement` and `propsTransform` have **no** canonical example — follow the component-override branch text above. The example also ships no `data/extensions.ts`, `search.ts`, or `vector.ts`; do not infer those from an adjacent file.
