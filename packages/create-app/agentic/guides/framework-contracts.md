# Installed Framework Contracts

Use this guide after app call sites and generated module facts have identified a named framework contract. These links point at the exact installed package source, so they are read-only version evidence: never edit `node_modules`, widen into directory discovery, or assume a contract from another installed version.

## Commands

- [`CommandHandler` and runtime context](../../node_modules/@open-mercato/shared/src/lib/commands/types.ts) define the typed lifecycle. `execute` returns `TResult`; `prepare`, `captureAfter`, `buildLog`, `undo`, and `redo` are separate optional hooks. Preserve authenticated scope and reuse `transactionalEm` when the caller supplies it.
- [The command registry](../../node_modules/@open-mercato/shared/src/lib/commands/registry.ts) owns stable command IDs and lazy loading. Register through discovery, never reach into registry internals or silently replace an existing production ID.
- [`runCrudCommandWrite`](../../node_modules/@open-mercato/shared/src/lib/commands/runCrudCommandWrite.ts) is the command-owned persistence seam for CRUD-backed handlers. It writes, applies custom fields, then emits CRUD/index side effects. A command-backed `makeCrudRoute` still owns factory authentication, scope, interceptors, guards, and synchronous lifecycle; do not persist or emit the same change a second time in the route.

## CRUD and Events

- [`makeCrudRoute`](../../node_modules/@open-mercato/shared/src/lib/crud/factory.ts) is the installed route factory contract. Keep per-method metadata, explicit tenant/organization fields, stable entity/command IDs, schemas, transformations, guards, and optional indexer/enricher configuration aligned with `.ai/guides/contracts.md`.
- [`createModuleEvents`](../../node_modules/@open-mercato/shared/src/modules/events/factory.ts) declares and validates typed event IDs. Its `emit` delegates immediately to the bootstrapped event bus; it is not transaction-aware. Emit only after commit by call order, or use the post-write side-effect flow already provided by `runCrudCommandWrite`/the data engine.

## Concurrency and HTTP

- [Command optimistic locking](../../node_modules/@open-mercato/shared/src/lib/crud/optimistic-lock-command.ts) accepts either an explicit expected version or the request header. `assertOptimisticLock` is additive: it does nothing when the token is missing or locking is disabled, and throws the shared structured 409 on mismatch. A typed `expected_updated_at` field is an app convention that must be validated and passed as `expected`; it is not inferred automatically.
- [`readJsonSafe`](../../node_modules/@open-mercato/shared/src/lib/http/readJsonSafe.ts) reads `Request`, `Response`, or string bodies and returns the supplied fallback for empty or invalid JSON. Prefer it over an unguarded `.json()` call when a response may be empty or non-JSON.

## Data Engine

- [The data engine](../../node_modules/@open-mercato/shared/src/lib/data/engine.ts) owns custom-entity storage and generic ORM CRUD side effects. Its mutation helpers flush their own writes unless an explicit surrounding contract says otherwise, and they do not derive tenant/organization scope for the caller. Pass trusted scope, use the caller's transaction seam where supported, and drain queued ORM side effects only after the durable write succeeds.

If these exact files do not answer the named question, invoke `om-framework-context` for that single contract. Report the installed version and any source/type limitation instead of guessing.
