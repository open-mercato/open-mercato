# Optional Module Surfaces

Load only the rows the brief requires.

| Capability | Required work |
|---|---|
| Registration | `index.ts`, `{ id, from: '@app' }` in `src/modules.ts`, generation. |
| DI | `di.ts` registrations with stable tokens; resolve services, never instantiate infrastructure. |
| ACL/setup | Declare features, dependencies, default grants, idempotent tenant/default/example seeds, ACL sync. |
| Events | `events.ts` typed declaration before emission; stable past-tense ID; idempotent subscriber. |
| Worker/progress | Load `runtime-cache-and-queues.md`; use discovered metadata, scoped/idempotent payloads, bounded concurrency/retry, command writes, and `ProgressJob`. |
| Search | `search.ts` with a stable colon-form entity ID, scoped `fieldPolicy` (`excluded` for sensitive values, hash-only for approved exact lookup), and result metadata. CRUD uses `indexer: { entityType }`; bulk writes use the SearchIndexer reindex path. Vector sources provide `checksumSource`, token results provide `formatResult`, and tests prove delete/reindex deterministic convergence without sleeps. |
| Cache | Load `runtime-cache-and-queues.md`; use the DI cache, tenant/org/entity tags, and post-commit invalidation including undo/sub-resource paths. |
| Notifications | type, renderer, subscriber/handler, ACL, client reactive behavior when needed. |
| CLI | discovered command, scoped inputs, compiled-package test. |
| Custom fields/entities | `ce.ts`, stable entity ID, CRUD/UI normalization, save/reload/clear tests. |
| Translatable fields | `translations.ts`; entity-field translation manager registration. |
| AI/workflows | Invoke their dedicated skills; keep discovered root filenames. |

Every added surface needs a real caller or acceptance path. Do not add speculative empty files.
