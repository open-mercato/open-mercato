# Runtime Cache and Queues

Load only when the brief adds or changes server cache behavior or durable queued work.

## Cache

1. Resolve the configured cache through DI: `container.resolve<CacheStrategy>('cache')`, with `CacheStrategy` imported from `@open-mercato/cache`. Do not instantiate a strategy or depend on Redis directly inside a module.
2. Use cache-aside reads (`get`, compute, then `set`) with a bounded millisecond TTL and stable tags. Keys/tags name the module, resource, organization, record/filter, and result version; never include plaintext secrets, tokens, encrypted values, or unbounded user input.
3. The configured wrapper partitions keys and tags by the active cache tenant. Request containers establish that context. In workers, CLI, or subscribers where it is not guaranteed, import `runWithCacheTenant` from `@open-mercato/cache` and wrap both reads and `deleteByTags`; still put organization scope in the logical key/tag.
4. Prefer tag invalidation with `deleteByTags` over key enumeration. CRUD routes/commands should reuse `invalidateCrudCache` from `@open-mercato/shared/lib/crud/cache` or the cache aliases already emitted by `emitCrudSideEffects`/`emitCrudUndoSideEffects`.
5. Invalidate every affected collection, record, aggregate, and sub-resource only after commit. Create/update/delete/action and undo/compensation paths invalidate the same aliases. If invalidation can fail after a durable write, log structured scope-safe evidence and provide a recovery/rebuild path; never use stale cached data as authorization or mutation truth.
6. Test miss/hit/TTL, two tenants and organizations, create/update/delete/sub-resource invalidation, undo, and an injected rollback proving no invalidation happened before commit.

## Queues and discovered workers

1. Import `createModuleQueue` and `Queue` from `@open-mercato/queue`. Keep one stable module-owned queue-name constant and a process-memoized typed getter; `createModuleQueue<T>(name, { concurrency })` selects local development storage or the configured async backend. Do not construct BullMQ/Redis clients in a module.
2. Validate a JSON-serializable payload at enqueue and handler boundaries. Carry trusted `tenantId`, explicit `organizationId` (nullable only for an authorized tenant-wide contract), a job/domain type, stable operation/idempotency key, and scalar IDs. Never serialize request containers, ORM entities, credentials, decryption keys, or ambient auth state.
3. Enqueue only after commit. When losing the enqueue after commit is unacceptable, persist an outbox/recovery marker in the transaction and drain it idempotently; never move the external enqueue inside the database transaction.
4. Put each auto-discovered handler in `workers/<id>.ts`. Export `metadata: WorkerMeta = { queue, id: '<module>:<job>', concurrency }` and a default handler accepting `QueuedJob<T>` plus `JobContext` (extend it only with typed DI resolution). Run `yarn generate`; do not manually edit the generated worker registry.
5. The stock local and async strategies make three attempts with exponential backoff; `JobContext.attemptNumber` is 1-based. A handler must be idempotent across every attempt, reuse the payload's operation key, dispatch commands/services for domain writes, advance cursors/checkpoints only after their unit commits, and throw retryable failures instead of swallowing them.
6. Bound concurrency against database/provider capacity. Make terminal failure observable through structured logs and an app-owned status/progress/error record when users need visibility; operators can use `yarn mercato queue status <queue>` and run `yarn mercato queue worker <queue>` or `--all`.
7. Test duplicate delivery, transient failure then success, exhausted retries, worker restart, scope isolation, enqueue failure/recovery, command rollback, and status/progress convergence without arbitrary sleeps.
