# Optional Module Surfaces

Load only the rows the brief requires.

| Capability | Required work |
|---|---|
| Registration | `index.ts`, `{ id, from: '@app' }` in `src/modules.ts`, generation. Treat the shipped `src/modules.ts` baseline as protected source: append exactly `enabledModules.push({ id: '<module>', from: '@app' })`; do not rewrite, compress, map, spread, sort, or reformat existing entries or the computed official-module registry. |
| DI | `di.ts` registrations with stable tokens; resolve services, never instantiate infrastructure. |
| ACL/setup | Declare stable resource features such as `<module>.<resources>.view`/`manage` and dependencies as the named `export const features = [...]` in `acl.ts`, followed by `export default features`; generated registry code expects both exports. Export `setup: ModuleSetupConfig = { defaultRoleFeatures, ... }` (plus default when useful) from `setup.ts`; do not rename the `features` export or export `defaultRoleFeatures` as a disconnected top-level map. Keep tenant/default/example seeds idempotent and run ACL sync. |
| Events | `events.ts` imports `createModuleEvents` from `@open-mercato/shared/modules/events`, declares `const events = [{ id, label, category: 'crud' }] as const` (`category` is `crud`, `lifecycle`, `system`, or `custom`), then exports `createModuleEvents({ moduleId, events })`. It receives one options object, not positional module/event arguments. Use typed stable past-tense IDs before emission and idempotent subscribers; do not invent a shared `lib/events` entrypoint. |
| Worker/progress | Load `runtime-cache-and-queues.md`; use discovered metadata, scoped/idempotent payloads, bounded concurrency/retry, command writes, and `ProgressJob`. |
| Search | `search.ts` imports `SearchModuleConfig`/`SearchBuildContext`/`SearchIndexSource`/`SearchResultPresenter` from `@open-mercato/shared/modules/search` and exports `searchConfig`. Its stable colon-form entity uses the exact `entityId` key and declares `fieldPolicy: { searchable: [...], excluded: [...] }`; sensitive values remain excluded and only approved hash siblings support exact lookup. `buildSource(ctx)` returns `{ text: string[], presenter, checksumSource: { record: ctx.record, customFields: ctx.customFields } }`; `formatResult(ctx)` independently derives its presenter from `ctx.record`, and `resolveUrl(ctx)` reads the ID from `ctx.record.id`. `SearchResultPresenter` permits only `title`/`subtitle`/`icon`/`badge` and has no `metadata`; indexed structured values belong in `SearchIndexSource.fields`. CRUD uses `indexer: { entityType }`; bulk writes use the SearchIndexer reindex path. Do not invent `entityType` in `search.ts`, `ctx.presenter`, `ctx.id`, `convergenceKey`, `result`, per-field policy keys, `body`, or `href` aliases. Tests prove delete/reindex deterministic convergence without sleeps. |
| Cache | Load `runtime-cache-and-queues.md`; use the DI cache, tenant/org/entity tags, and post-commit invalidation including undo/sub-resource paths. |
| Notifications | type, renderer, subscriber/handler, ACL, client reactive behavior when needed. |
| CLI | discovered command, scoped inputs, compiled-package test. |
| Custom fields/entities | In `ce.ts`, use the generated-registry contract `export const entities = [{ id: '<module>:<entity>', fields: [...] }]` followed by `export default entities`; do not rename it to `customEntities` or use `entityId`. Include stable IDs, CRUD/UI normalization, and save/reload/clear tests. |
| UI locale messages | Put generated module messages in `i18n/<locale>.json`, not `locales/<locale>.json`; use stable namespaced keys and rerun generation. This is distinct from translatable entity fields. |
| Translatable fields | `translations.ts`; entity-field translation manager registration. |
| AI/workflows | Invoke their dedicated skills; keep discovered root filenames. |

Every added surface needs a real caller or acceptance path. Do not add speculative empty files.
