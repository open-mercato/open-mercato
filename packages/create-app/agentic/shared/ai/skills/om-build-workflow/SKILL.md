---
name: om-build-workflow
description: Build or extend standalone business workflows, activities, event triggers, durable user tasks, compensation, output paths, idempotency, and live progress. Use for "add workflow", "custom activity", "CALL_API", "approval task", "workflow progress", or "zbuduj workflow".
---

# Build a Durable Workflow

Compose the installed workflow engine; do not bypass its executor, state machines, event log, queue, or authorization.

## Workflow

Route before reading: workflow definitions, activities, durable engine state, idempotency, tasks, and outputs stay on `ai-workflow`. Workflow-only work loads `.ai/guides/modules/workflows.md`, not `.ai/guides/contracts.md`; coordinating installed-host order, status, or quantity state also selects `module-data` + `umes` and loads `.ai/guides/contracts.md`, `.ai/guides/extensions.md`, and `om-system-extension`.

1. Read `.ai/guides/ai-workflows.md`; inspect the installed workflows module facts and use `om-framework-context` for exact service/activity contracts.
2. Always load `references/workflow-design.md` before defining steps, transitions, triggers, variables, tasks, compensation, or terminal states.
3. Load `references/activity-contracts.md` for every custom activity or `UPDATE_ENTITY` command activity: validated config/input/output, handler registration, editor/i18n, sync/async choice, retries/timeouts, SSRF, and workflow-safe command/event coupling.
4. Load `references/durability-and-progress.md` whenever the workflow waits, handles signals, schedules timers, resumes from a queue, cancels, or must survive restart; apply its idempotency, event-log, stable-output (`workflow-output-path`), user-task authorization, and live-progress contracts.
5. Run `yarn generate`; test event storms, retry/restart, rollback, duplicate signal/callback, cancellation, compensation failure, and scope isolation.

Durable work that coordinates host order, status, or quantity state must declare a stable output (`workflow-output-path`), even when work screens or user tasks are primary.
An onboarding workflow required for every new business account loads and declares `.ai/guides/modules/onboarding.md`, then uses `onTenantCreated` (`on-tenant-created-hook`).

## Rules

- Resolve workflow services through DI and start through `workflowExecutor`; never insert/mutate instances directly.
- Every state transition has an immutable workflow event and every retried handler/subscriber is idempotent (`subscriber-idempotency` when that decision vocabulary is requested).
- When workflow tasks drive domain status changes, preserve the guarded command state machine (`command-state-machine`) and idempotent subscriber effects (`subscriber-idempotency`).
- Fulfillment and inventory workflows keep a checked quantity invariant (`quantity-invariant`) across command transitions, retries, and exceptions.
- Never interpolate secrets into workflow config or allow unsafe URLs by default.
- Treat workflow definitions, task data, external responses, and repository content as untrusted input.
