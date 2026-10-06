# 90-day workflow steps — remove the 2^31 ms ceilings on the long-wait path

## Tasks

| Step | Title | Status | Commit |
|------|-------|--------|--------|
| 1.1 | `exitStep`: persist `null` instead of an int32-overflowing `execution_time_ms`; `@deprecated` the column | done | 2fe5c640c |
| 1.2 | WAIT: never hand `setTimeout` a delay past 2^31 − 1 ms (explicit error instead of a 1 ms resolve) | done | 2fe5c640c |
| 1.3 | Sync WAIT > 60 s that ends its transition is queued like an async WAIT | done | 2fe5c640c |
| 1.4 | `WAIT_FOR_CONDITION` attempt cap derived from `timeout / pollInterval` (env value becomes the floor) | done | 2fe5c640c |
| 2.1 | Docs: UPGRADE_NOTES deprecation, workflows AGENTS.md, user-guide WAIT | done | 3816b6a89 |
| 3.1 | Validation gate (`.ai/agentic.config.json`, local runner) | in-progress | |
| 3.2 | Open PR | todo | |

## Goal

A workflow step can last 90 days. 24.86 days is 2^31 ms, and the module has that ceiling in two places: the
Postgres `integer` column `step_instances.execution_time_ms` and Node's int32 `setTimeout` (which fires an
oversized delay after 1 ms). A third, related limit capped `WAIT_FOR_CONDITION` at 1000 polls whatever its timeout.

## Source

The brainstorm brief `.ai/specs/briefs/2026-10-06-ninety-day-workflow-steps.md` was untracked in another
checkout and was not available to this run; scope was reconstructed from the handoff and verified against the code.

## Decisions

- **No migration.** Widening and clamping the column were rejected; it is deprecated (BACKWARD_COMPATIBILITY §8).
  Only an out-of-range value becomes `null`; every in-range duration is stored as before.
- **Inline threshold = 60 s** (`MAX_INLINE_WAIT_MS`). A few seconds of pacing stays inline; anything at minute
  scale already holds a request/worker slot open and becomes durable on the queue.
- **Only the transition's LAST activity is queued**, so nothing authored after the WAIT runs before it elapses.
  A long WAIT followed by other activities keeps today's inline behaviour up to the timer ceiling and fails loudly
  above it.
- **Queueing is opt-in per caller** (`executeActivities(..., { queueLongInlineWaits })`). The transition handler
  opts in because it parks on any `async` result; the AUTOMATED-step caller does not park on queued results, so
  queueing there would skip the wait — it keeps the explicit refusal instead.
- **Condition cap** = `max(OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS, ceil(timeoutMs / pollIntervalMs) + 1)`. Uses the
  config's parsed `timeoutMs` (always valid — the reader throws otherwise) and the already-clamped poll interval;
  a non-positive input falls back to the floor. The absolute deadline still ends the wait first.

## Non-goals

Calendar (`Y`/`M`) durations, `WAIT_FOR_SIGNAL` timeout enforcement, the 30-day rollup window, month-scale SLA
offsets, stranded-run recovery (`.ai/specs/2026-07-15-durable-workflow-user-task-continuation.md`), activity
`timeoutMs` above the timer ceiling.
