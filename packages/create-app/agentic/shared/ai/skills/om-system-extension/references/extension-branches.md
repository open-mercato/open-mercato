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
