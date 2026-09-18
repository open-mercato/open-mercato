# Installed Framework Contracts

Use this digest after app call sites and generated facts identify a named framework contract. Links are read-only version evidence: never edit or enumerate `node_modules`. If a question is unanswered, invoke `om-framework-context` for only that contract.

## Command handler and registry

[`CommandHandler`](../../node_modules/@open-mercato/shared/src/lib/commands/types.ts) has a stable `id` and one required operation, `execute(input, ctx)`. Its optional lifecycle is deliberately split:

- `prepare(input, ctx)` captures the before snapshot before execution.
- `execute(input, ctx)` performs the durable operation and returns the public result.
- `captureAfter(input, result, ctx)` can capture the after snapshot.
- `buildLog({ input, result, ctx, snapshots })` returns action-log metadata; returning `null` or `skipLog` suppresses a normal log entry.
- `undo({ input, ctx, logEntry })` and `redo(...)` are only valid when the handler owns a reversible contract. Undo payload is stored under `commandPayload`, not `logEntry.payload`; use the shared undo extractor.

`CommandRuntimeContext` carries authentication, selected organization scope, the DI container, optional request and sync origin, bulk-import suppression, and an optional `transactionalEm`. A handler must preserve this scope and reuse `transactionalEm` when supplied instead of opening an independent transaction.

[The command registry and `registerCommand`](../../node_modules/@open-mercato/shared/src/lib/commands/registry.ts) own handler discovery. Register through the normal `commands.ts` discovery surface. IDs are global and stable: duplicates throw outside development; development permits HMR replacement. Never silently replace a production ID or call registry internals from a module.

## Atomic CRUD command writes

[`runCrudCommandWrite`](../../node_modules/@open-mercato/shared/src/lib/commands/runCrudCommandWrite.ts) is the command-owned persistence seam for CRUD-backed handlers. It:

It resolves or reuses an entity manager; passes all phases through transactional-by-default `withAtomicFlush`; applies custom fields after durable phases; and emits configured CRUD/index side effects from `sideEffect()`.

Every phase must use the callback's entity manager. Set `transaction: false` only when an enclosing transaction already provides the atomic boundary. `sideEffect()` must return the final entity and stable identifiers after phases have completed. Commands using this helper own generic event/reindex emission; their route must not repeat it.

## `makeCrudRoute`

[`makeCrudRoute`](../../node_modules/@open-mercato/shared/src/lib/crud/factory.ts) is the installed HTTP factory. Its `metadata.GET/POST/PUT/DELETE` gates authentication, immutable feature requirements, and rate limits per method. The factory also retains tenant/organization selection checks, interceptors, mutation guards, synchronous before/after lifecycle subscribers, response shaping, command operation headers, and errors. Command-backed actions extend that envelope; they do not replace it.

ORM defaults are `id`, `organizationId`, `tenantId`, and `deletedAt`; `null` disables an automatic field. Do not disable scope merely because a handler checks it too. With the specialized read-only `omitAutomaticTenantOrgScope`, `buildFilters` must encode all visibility and fail closed; update/delete scoping remains automatic.

### List sequence

- The list zod schema parses query parameters; before interceptors may rewrite it, followed by another parse.
- `hooks.beforeList(validatedQuery, ctx)` runs after rewriting and before the query. Resolve request-specific state through `ctx`, never module-global mutable state.
- `list.transformItem(item)` is a synchronous per-row projection. On the Query Engine path it runs before custom-field decoration, translation overlay, and response enrichment. It must not perform async I/O.
- `hooks.afterList(payload, { ...ctx, query })` receives the mutable response payload on cache, query-engine, ORM-fallback, export, and empty-result branches. Response enrichers configured by `enrichers.entityId` run after `afterList`; after interceptors also remain part of the factory response pipeline.

Keep entity/enricher IDs and list fields, filters, sorting, joins, and export settings stable. `buildFilters` may be async; `transformItem` may not. Query Engine options do not apply when the route omits `entityId` or `fields`.

### Command-backed mutations

`actions.create`, `actions.update`, and `actions.delete` select the command path by stable `commandId`. An action may map validated input, add log metadata, choose response/status, and provide resource identity. The command performs persistence and asynchronous generic CRUD side effects. The factory still performs:

- route authentication and selected-scope rejection;
- request interceptors and schema validation;
- synchronous lifecycle events and mutation guards;
- command-bus execution and action-log operation headers;
- response interceptors, guard success callbacks, and cache invalidation.

Thus commands own the asynchronous configured CRUD event/index work, not the factory's synchronous lifecycle. The factory deliberately does not double-emit the command's generic event.

## Typed module events

[`createModuleEvents`](../../node_modules/@open-mercato/shared/src/modules/events/factory.ts) adds `module` to definitions, registers IDs for runtime validation, and returns typed `eventsConfig.emit`. The emitted ID must be declared by that configuration.

`eventsConfig.emit(eventId, payload, options)` delegates immediately to the bootstrapped event bus. It does not begin, join, or wait for a database transaction. Calling it before commit can publish an event for a write that later rolls back. Emit by call order only after the durable write succeeds, or use the post-write flow supplied by `runCrudCommandWrite`/the Data Engine. `clientBroadcast` and `portalBroadcast` are declaration flags, not transaction controls.

## Optimistic locking

[Command optimistic-lock helpers](../../node_modules/@open-mercato/shared/src/lib/crud/optimistic-lock-command.ts) normalize an explicit expected version or request header and compare it with actual `updated_at`. `assertOptimisticLock` does nothing when the token is absent or locking is disabled, and throws the shared 409 conflict on mismatch.

`expected_updated_at` is an app convention, not inferred. Validate and pass it as `expected`; load and assert inside the mutation transaction. Return `updated_at`/`updatedAt` so the UI can send the version.

## Defensive JSON reads

[`readJsonSafe`](../../node_modules/@open-mercato/shared/src/lib/http/readJsonSafe.ts) accepts a `Request`, `Response`, or string and returns the supplied fallback for empty/invalid JSON. It is not schema validation: narrow or zod-parse its result.

## Data Engine ORM operations

[The Data Engine](../../node_modules/@open-mercato/shared/src/lib/data/engine.ts) provides `createOrmEntity`, `updateOrmEntity`, and `deleteOrmEntity` for generic ORM-backed mutation seams:

- `createOrmEntity({ entity, data })` creates, persists, and flushes, then returns the entity.
- `updateOrmEntity({ entity, where, apply })` loads one matching entity, returns `null` when absent, applies the callback, flushes, and returns the entity.
- `deleteOrmEntity({ entity, where, soft, softDeleteField })` loads one matching entity, returns `null` when absent, then soft-deletes or removes and flushes.

These helpers do not derive tenant/organization scope or automatically emit. The caller owns complete `where` scope and create fields. `markOrmEntityChange` queues event/index work, `flushOrmEntityChanges` drains it, and `emitOrmEntityEvent` emits directly. Drain only after the durable write; suppressed indexing must be rebuilt.

## Escalation rule

Start here, then the one exact linked file. If unanswered, invoke `om-framework-context` with a narrow query and report the installed version and limitation. Never copy a private implementation detail into an app contract.
