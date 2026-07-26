# Optional Module Surfaces

Load only the rows the brief requires.

| Capability | Required work |
|---|---|
| Registration | `index.ts`, `{ id, from: '@app' }` in `src/modules.ts`, generation. |
| DI | `di.ts` registrations with stable tokens; resolve services, never instantiate infrastructure. |
| ACL/setup | Declare stable resource features such as `<module>.<resources>.view`/`manage` and dependencies in `acl.ts`. Export `setup: ModuleSetupConfig = { defaultRoleFeatures, ... }` (plus default when useful) from `setup.ts`; do not export `defaultRoleFeatures` as a disconnected top-level map. Keep tenant/default/example seeds idempotent and run ACL sync. |
| Events | `events.ts` typed declaration before emission; stable past-tense ID; idempotent subscriber. |
| Worker/progress | Load `runtime-cache-and-queues.md`; use discovered metadata, scoped/idempotent payloads, bounded concurrency/retry, command writes, and `ProgressJob`. |
| Search | `search.ts` with a stable colon-form entity ID, scoped `fieldPolicy` (`excluded` for sensitive values, hash-only for approved exact lookup), and result metadata. CRUD uses `indexer: { entityType }`; bulk writes use the SearchIndexer reindex path. Use the discovered `SearchModuleConfig` names: `buildSource` returns `checksumSource` for change detection and `formatResult` builds token/result presentation; do not invent `convergenceKey` or `result` aliases. Tests prove delete/reindex deterministic convergence without sleeps. |
| Cache | Load `runtime-cache-and-queues.md`; use the DI cache, tenant/org/entity tags, and post-commit invalidation including undo/sub-resource paths. |
| Notifications | type, renderer, subscriber/handler, ACL, client reactive behavior when needed. |
| CLI | discovered command, scoped inputs, compiled-package test. |
| Custom fields/entities | `ce.ts`, stable entity ID, CRUD/UI normalization, save/reload/clear tests. |
| Translatable fields | `translations.ts`; entity-field translation manager registration. |
| AI/workflows | Invoke their dedicated skills; keep discovered root filenames. |

Every added surface needs a real caller or acceptance path. Do not add speculative empty files.
