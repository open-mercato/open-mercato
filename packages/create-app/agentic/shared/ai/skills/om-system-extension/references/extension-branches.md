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

## CrudForm section policy

For a Todo showcase policy, start at the [Todo showcase declaration](../../../../src/modules/example/form-sections.ts). Read only the sources mapped to that scenario. Follow [required leaf coverage](../../../../src/modules/example/references/crud-form-extensions/required-coverage.md) for an uncovered leaf or the [typed configuration example](../../../../src/modules/example/references/module-overrides.reference.ts) for an exact section mask.

Select a single matching recipe before reading Example sources. Open `form-sections.ts` first, then exactly the files in that row. For the uncovered leaf or exact mask, use the reference above as the second read. This recipe supplies the Example sources for planning and review.

| Todo showcase recipe | Read next |
|---|---|
| Keep a hidden title on edit | `src/modules/example/todo-showcase-update.client.ts` |
| Default the hidden title on create | `src/modules/example/todo-showcase-create.client.ts` |
| Replace the completion control | `src/modules/example/todo-showcase-status.client.ts` |
| Patch or remove a field, validate priority, or add a season Custom Field | `src/modules/example/todo-showcase-sections.client.ts` |
| Version an extension table independently | `src/modules/example/data/entities.ts` and `src/modules/example/components/TodoShowcaseForm.tsx` |
| Show an optional observer warning after commit | `src/modules/example/components/TodoShowcaseForm.tsx` |
| Queue ERP delivery and show retry status | `src/modules/example/lib/exampleExternalErp.ts` and `src/modules/example/components/TodoShowcaseSync.tsx` |
| Check the guarded route and client request binding | `src/modules/example/api/todos/route.ts` and `src/modules/example/lib/todoShowcaseClient.ts` |
| Preserve the standard Todo form and pages | `src/modules/example/components/TodoForm.tsx`, `src/modules/example/backend/todos/create/page.tsx` and `src/modules/example/backend/todos/[id]/edit/page.tsx` |


A policy that only hides, preserves, defaults or masks stays in `umes`. Reusing an existing guarded write does not add a data route. Add `backend-ui` for a rendered replacement, relabel, feedback or a visible form variant. Add `module-data` for a new persisted Custom Field or app-owned extension table. External delivery adds `integration`, with `backend-ui` for status or retry controls.

- Author `crudFormExtensions` with `defineCrudFormExtension`, `add`/`hide`/`replace`/`modify`, and `field.*` and `store.*` from `@open-mercato/ui/backend/crud-form-extensions`. Use `modify` on field-granular sections and `hide` or `replace` on component-only sections. Use i18n keys, serializable field definitions, and literal browser imports.
- Added fields inherit a section store or use `store.customField()`. Check the host's definition-set binding, or publish a scoped app-owned entity for `store.table` or `store.external`. Keep storage and validation callbacks on the server. Use `crudFormSections` primitives for a custom host adapter or independent mutation surface.
- Run `yarn generate`, review the compiled capabilities, routes, and ownership, and commit `form-sections.revisions.json`. Verify the authorized write, denied write, and masked configuration using the exact `overrides.forms.sections` key.

## Markdown code-block language choices

For `MarkdownField`, resolve `section:ui.inputs.MarkdownField` from the framework extension catalog and read the exact installed [props and handle](../../../../node_modules/@open-mercato/ui/src/backend/inputs/MarkdownField.tsx) and [language patch contract](../../../../node_modules/@open-mercato/ui/src/backend/markdown/codeBlockLanguages.ts). Prefer `propsTransform` in `widgets/components.ts` for `codeBlockLanguages`; preserve incoming props and merge the caller's existing language patch. A string adds or renames a choice, `null` hides a nonempty tag, and `{ label, labelKey }` supplies a translated label with fallback. Keep the empty-tag choice and existing Markdown content, including hidden or unknown tags, unchanged. A new choice does not install a syntax highlighter. App-level registration uses the existing `widgets.components` domain described in `unified-overrides.md`.

## Canonical example source

One compiling contributor per branch, plus the callers that consume it. Open only your branch's row.

| Branch | Exact file |
|---|---|
| Mutation guard bound to entity kind + operations | [`data/guards.ts`](../../../../src/modules/example/data/guards.ts) |
| Response enricher with `enrichMany` batching, `fallback`, timeout, `cacheableOnListHit` | [`data/enrichers.ts`](../../../../src/modules/example/data/enrichers.ts) |
| API interceptors: exact-route and wildcard, rejection, timeout, query rewrite, cross-module `?ids=` narrowing, `after` merge | [`api/interceptors.ts`](../../../../src/modules/example/api/interceptors.ts) |
| Command interceptors: `beforeExecute` → `afterExecute` state hand-off | [`commands/interceptors.ts`](../../../../src/modules/example/commands/interceptors.ts) |
| Hosts this module exposes (`defineModuleExtensionPoints`) | [`extension-points.ts`](../../../../src/modules/example/extension-points.ts) |
| Component replacement, wrapper, and props transform with a mounted host | [`widgets/components.ts`](../../../../src/modules/example/widgets/components.ts) |
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

The readable `umes.component-replacement` capability covers all three component modes; use its canonical contributor for registration syntax and installed source for the target's props. The example also ships `search.ts` (indexed as `search.module-config`), so read that one rather than guessing. It ships no `data/extensions.ts` and no `vector.ts`; do not infer either from an adjacent file. `surface-map.md` is the authority on what is absent — check it before assuming a surface is missing.
