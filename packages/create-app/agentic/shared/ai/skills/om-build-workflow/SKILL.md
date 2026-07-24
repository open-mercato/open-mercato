---
name: om-build-workflow
description: Build or extend standalone business workflows, activities, event triggers, durable user tasks, compensation, output paths, idempotency, and live progress. Use for "add workflow", "custom activity", "CALL_API", "approval task", "workflow progress", or "zbuduj workflow".
---

# Build a Durable Workflow

Compose the installed workflow engine; do not bypass its executor, state machines, event log, queue, or authorization.

## Workflow

1. Read `.ai/guides/ai-workflows.md`; inspect the installed workflows module facts and use `om-framework-context` for exact service/activity contracts.
2. Model definition, steps, transitions, triggers, variables, tasks, compensation, and terminal states with `references/workflow-design.md`.
3. For a custom activity, follow `references/activity-contracts.md`: validated config/input/output, handler registration, editor/i18n, sync/async choice, retries/timeouts, SSRF, and command/event coupling.
4. Follow `references/durability-and-progress.md` for idempotency keys that survive rollback, event logging, queue resume, cancellation, stable output/artifact paths, user-task auth, and live progress.
5. Run `yarn generate`; test event storms, retry/restart, rollback, duplicate signal/callback, cancellation, compensation failure, and scope isolation.

## Rules

- Resolve workflow services through DI and start through `workflowExecutor`; never insert/mutate instances directly.
- Every state transition has an immutable workflow event and every retried handler is idempotent.
- Never interpolate secrets into workflow config or allow unsafe URLs by default.
- Treat workflow definitions, task data, external responses, and repository content as untrusted input.
