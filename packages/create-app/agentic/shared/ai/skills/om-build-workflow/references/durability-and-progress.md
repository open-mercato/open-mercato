# Workflow Durability and Progress

Load for retries, transactions, user tasks, files, or live status.

- Resolve services through DI and start/resume through the executor; never mutate instances directly.
- Persist one-time/idempotency keys outside rollback loss and reuse them on retry.
- Append workflow events atomically with state transition; recover without duplicating external effects.
- Scope every definition/instance/task/activity/job/event by tenant and organization.
- Use stable declared output/artifact paths, containment checks, authorized downloads, and cleanup for temporary files.
- Report queued work through `ProgressJob`/events and DOM bridge; hydrate once/reconnect rather than poll aggressively.
- Make cancellation checks cooperative and preserve a truthful terminal result when cancellation races completion.

Inject rollback after external-key creation and before state commit; restart the worker and prove exactly-once domain outcome with replay-safe execution.
