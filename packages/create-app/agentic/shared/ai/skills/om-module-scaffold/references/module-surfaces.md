# Optional Module Surfaces

Load only the rows the brief requires.

| Capability | Required work |
|---|---|
| Registration | `index.ts`, `{ id, from: '@app' }` in `src/modules.ts`, generation. |
| DI | `di.ts` registrations with stable tokens; resolve services, never instantiate infrastructure. |
| ACL/setup | Declare features, dependencies, default grants, idempotent tenant/default/example seeds, ACL sync. |
| Events | `events.ts` typed declaration before emission; stable past-tense ID; idempotent subscriber. |
| Worker/progress | metadata, scoped/idempotent job, bounded concurrency/retry, command writes, `ProgressJob`. |
| Search | `search.ts`, indexed fields/result metadata, reindex and deterministic convergence assertions. |
| Cache | DI cache, tenant/org/entity tags, post-commit invalidation including undo/sub-resource paths. |
| Notifications | type, renderer, subscriber/handler, ACL, client reactive behavior when needed. |
| CLI | discovered command, scoped inputs, compiled-package test. |
| Custom fields/entities | `ce.ts`, stable entity ID, CRUD/UI normalization, save/reload/clear tests. |
| Translatable fields | `translations.ts`; entity-field translation manager registration. |
| AI/workflows | Invoke their dedicated skills; keep discovered root filenames. |

Every added surface needs a real caller or acceptance path. Do not add speculative empty files.
