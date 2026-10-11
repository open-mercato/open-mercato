# Execution plan — absolute user-task deadline (`deadline.at`)

Source doc: `.ai/specs/2026-07-26-workflows-ux-redesign.md` (§6.1 "When") — extended by issue #7181.
Issue: open-mercato/open-mercato#7181

## Goal

Let a USER_TASK's deadline be an absolute, interpolated ISO date/datetime (`userTaskConfig.deadline.at`,
e.g. `'{{context.dueDate}}'`) as an alternative to the creation-anchored `duration`, so tasks whose
due date is computed elsewhere still get reminders and breach handling.

## Scope

- `packages/core/src/modules/workflows/data/task-primitives.ts` — `taskDeadlineSchema` gains optional
  `at`, exactly one of `duration` / `at` (save-time validation). The Invoke Agent review keeps a
  duration-only deadline (its own schema) so an `at` there cannot be silently ignored.
- `lib/task-resolution.ts` — pure `resolveTaskDeadline` (duration | interpolated absolute instant) and
  a strict ISO parser (`parseTaskDeadlineAt`).
- `lib/step-handler.ts` — task `dueDate` from `deadline.at`; unparseable/unresolved value fails the
  step closed with `INVALID_USER_TASK_DEADLINE`; SLA reminders/breach scheduled against it (no change
  in `task-sla.ts` — jobs already carry an absolute `deadlineAt`).
- `lib/task-inspector-config.ts` — Studio inspector round trip preserves an authored `deadline.at`.
- Tests, docs (`apps/docs/.../workflows/services.mdx`), spec changelog.

## Non-goals

- Updating a task's due date after creation (rescheduling queued SLA jobs, task PATCH endpoint) —
  the issue marks it optional; it needs a new API surface and is left as a follow-up.
- A dedicated Studio control for `deadline.at` (authored through the Code view / definition JSON for
  now; the inspector only preserves it).
- Absolute deadlines on the Invoke Agent disposition review.

## Semantics

- `at` is interpolated against the run context at task creation, like every other task field.
- Accepted values: ISO date `YYYY-MM-DD` (deadline = end of that day, `23:59:59.999Z`) or ISO datetime
  WITH an explicit offset or `Z`. A naive datetime, a non-ISO string, an unresolved template or an
  empty value fails the step closed — a deadline the author got wrong must surface.
- An instant already in the past is accepted: the breach fires immediately (existing scheduler rule).
- `deadline` keeps precedence over the legacy `slaDuration`.

## Risks

- `TaskDeadline.duration` becomes optional in the inferred type (additive schema change); in-module
  readers already guard with optional chaining.

## Implementation Plan

### Phase 1: Engine

- 1.1 Schema: `deadline.at` + mutual exclusivity; agent review keeps duration-only deadline.
- 1.2 Resolution + step handler: absolute due date, fail-closed parsing, dry-run report carries it.
- 1.3 Inspector round trip preserves `deadline.at`.
- 1.4 Unit tests (schema, resolution, step handler + SLA scheduling, inspector, regression).

### Phase 2: Docs

- 2.1 Docs page + spec changelog.

## Progress

PR: #7189

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Engine

- [x] 1.1 Schema: `deadline.at` + mutual exclusivity; agent review keeps duration-only deadline — 63f2d5c3a
- [x] 1.2 Resolution + step handler: absolute due date, fail-closed parsing, dry-run report carries it — a81c5ede0
- [x] 1.3 Inspector round trip preserves `deadline.at` — d6ac898b6
- [x] 1.4 Unit tests — db534e9b0

### Phase 2: Docs

- [x] 2.1 Docs page + spec changelog — fd33a712a
