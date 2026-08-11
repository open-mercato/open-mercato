# The Triggered Process Model (W1)

**Date:** 2026-08-11 · **Status:** ready to implement
**Umbrella:** [`2026-08-10-pre-release-remediation-plan.md`](./2026-08-10-pre-release-remediation-plan.md) — workstream W1
**Companion:** [`2026-08-11-agent-taxonomy.md`](./2026-08-11-agent-taxonomy.md) (W2) owns the proposal envelope this consumes; neither blocks the other.
**Scope:** enterprise `agent_orchestrator`. Core `workflows` is read, never renamed.

## TLDR

The module ships two concepts where the domain has one: an **agentic task** (a definition with a schedule, an input schema and an execution principal) and a **process** (a projection of a running workflow instance). The notes call for one **process**, entered by a trigger that may be internal, manual or external — "external trigger" being what "task" means today.

The rename is real but the architecture barely moves, because the code already has the right bones: `agent_task_definitions` is a definition, `agent_task_runs` is its instance, `agent_processes` is a projection rebuilt from events. What changes is the vocabulary, the fact that triggers become first-class rather than three unrelated mechanisms, and two new authored concepts — **milestones** and an optional **outcome**.

## Problem statement

### 1. "Task" and "process" name the same thing at different lifecycle points

| Today | What it actually is |
|---|---|
| `agent_task_definitions` | A **definition**: name, `target_type` (`agent`\|`workflow`), `input_schema`, `execution_principal_id`, `granted_features`, `schedule_cron`, `enabled` |
| `agent_task_runs` | An **instance** of that definition firing |
| `agent_task_event_triggers` | External entry into that definition |
| `agent_processes` | A **projection** — status, subject, counters, assignee, rebuilt from events by `lib/processes/agentProcessProjection.ts`. No authored fields at all. |

A user reading the UI sees "Agentic Tasks" and "Processes" as two features. They are one feature's definition and one feature's runtime view.

**This is the trap in the umbrella's own wording.** It says to merge `AgentTaskDefinition`/`AgentTaskRun` into "the process entities", which reads as three peers becoming one. A definition and a projection cannot merge — the projection has no authored state to preserve and is rebuilt from events on demand. "One process" therefore becomes **two records plus the existing projection**, which is what the code already is.

### 2. Triggers are three unrelated mechanisms

Cron lives on the definition (`schedule_cron`), events live in a sibling table (`agent_task_event_triggers`), and manual entry is a route (`POST /tasks/[id]/run`). Nothing enumerates "how can this process start", so no surface can answer it and no validation covers the set.

### 3. A business reader has no view of a process

The Studio shows workflow steps. A business reader needs named stages that survive a step being renamed. Nothing carries them.

### 4. A process does not record what it produced

A process that files a claim, drafts a contract or opens a case has no field naming the resulting object, so nothing links forward from the run to its result.

## Proposed solution

### The model

```
ProcessDefinition          ← agent_task_definitions + agent_task_event_triggers
  id, name, description
  target: { kind: 'agent' | 'workflow', agentId? , workflowId? }
  inputSchema, inputDefaults
  executionPrincipalId, grantedFeatures
  triggers: ProcessTrigger[]        ← NEW: one list, three kinds
  milestones: ProcessMilestone[]    ← NEW
  enabled

ProcessRun                 ← agent_task_runs
  definitionId, triggeredBy: { kind, ref? }
  status, input, startedAt, completedAt
  outcome: { type, id, label } | null   ← NEW, nullable

AgentProcess               ← unchanged projection
  rebuilt from events over ProcessRun; still the read model
  for status, subject, counters, assignee
```

The projection stays exactly as it is. This spec renames what it projects **over**, not the projection.

### Triggers become one declared list

```ts
export const processTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('schedule'),
    cron: z.string().min(1),
    timezone: z.string().default('UTC'),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('event'),
    eventId: z.string().min(1),
    filter: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('manual'),
    /** Features a caller needs beyond `processes.run` to start it by hand. */
    requireFeatures: z.array(z.string()).default([]),
  }),
])
```

- **`schedule`** absorbs `schedule_cron` / `schedule_timezone` / `schedule_enabled`. Validation stays `validateCronExpression` from `@open-mercato/scheduler/modules/scheduler/lib/cronParser` — the **deep import**, never the package root, which reaches server-only code and breaks the client bundle (guarded by `__tests__/client-server-boundary.test.ts`).
- **`event`** absorbs `agent_task_event_triggers` rows. The table collapses into the definition's jsonb: it carried no lifecycle of its own, and a trigger without its definition is meaningless.
- **`manual`** makes the existing run route a declared capability rather than an undocumented one. A definition with no `manual` trigger cannot be started by hand — today every definition can, silently.

`ProcessRun.triggeredBy` records which fired: `{ kind: 'schedule' }`, `{ kind: 'event', ref: <eventId> }`, `{ kind: 'manual', ref: <userId> }`. Today `agent_task_runs` cannot answer "why did this run".

### Milestones

```ts
export const processMilestoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),          // business-facing, authored here
  stepId: z.string().min(1),         // the workflow step it maps to
  order: z.number().int().min(0),
})
```

Stored, ordered, authored on the definition — per the umbrella's locked Q1. The consequence the gate accepted: because the label lives here rather than being read from the step, **renaming a step no longer changes what the business reader sees**. That is the point, and it is also the maintenance cost — the mapping becomes a thing that can drift.

**So the drift diagnostic is load-bearing, not a nicety.** A milestone naming a step the workflow no longer declares surfaces as a Problems-panel warning, reusing the shape core `workflows` already has for unknown outcome kinds and quarantined step config. It is a warning, not an error: a definition mid-edit must stay saveable.

Milestones apply only to `target.kind === 'workflow'`. An agent-targeted process has no steps to map, and declaring milestones on one is a validation error rather than a silent no-op.

### Outcome

```ts
outcome: z.object({
  type: z.string().min(1),           // entity type, e.g. 'claims:claim'
  id: z.string().min(1),
  label: z.string().optional(),      // snapshot, per the FK-id + snapshot rule
}).nullable()
```

Written on completion, mirroring the existing `subject*` shape. **Optional by decision** — a research or monitoring process produces nothing and stays valid. The label is a snapshot so the reference survives the source module being absent, per the cross-module rule in `packages/core/AGENTS.md`; it is never a cross-module ORM relation.

### The rename

| Today | Becomes |
|---|---|
| `agent_task_definitions` | `agent_process_definitions` |
| `agent_task_runs` | `agent_process_runs` |
| `agent_task_event_triggers` | *(collapsed into the definition's `triggers` jsonb)* |
| `agent_orchestrator.tasks.{view,manage,run}` | `agent_orchestrator.processes.{view,manage,run}` |
| `agent_orchestrator.task.{created,updated,deleted}` | `agent_orchestrator.process_definition.*` |
| `agent_orchestrator.task_run.{started,completed,failed}` | `agent_orchestrator.process_run.*` (keep `clientBroadcast: true`) |
| `agent_orchestrator.task_event_trigger.*` | *(deleted — no separate entity)* |
| `/backend/agentic-tasks` | folds into `/backend/processes` |
| `/api/agent_orchestrator/tasks*`, `/task-runs*` | `/api/agent_orchestrator/process-definitions*`, `/process-runs*` |

`agent_orchestrator.processes.view` already exists (`acl.ts:96`) for the projection surface; `tasks.view` merges into it rather than adding a fourth feature. `defaultRoleFeatures` in `setup.ts` updates in the same change, and `yarn mercato auth sync-role-acls` runs for existing tenants.

**The one surface that does not move:** core `workflows` keeps `/backend/tasks`, its bridge redirect, and the frozen `workflows.tasks.list` tableId that the enterprise Caseload row action binds to. W1 renames the *enterprise* task concept; the core user-task one is released and untouched.

### Migrations: squash, do not stack

The module's snapshot already fails to record `agent_eval_case_runs`, `agent_eval_suite_runs`, `agent_eval_results.eval_case_run_id`, `agent_proposals.source` and `agent_runs.source`, so `yarn db:generate` emits non-idempotent DDL today. Stacking an alter-heavy rename chain on top makes it worse.

Replace the module's migrations with **one current-state migration** and regenerate `migrations/.snapshot-open-mercato.json` from it. Legitimate because no deployment holds these tables (module absent from `origin/develop`), and it clears the W4 defect in passing. W2's `agent_proposals.selected_option_id` and its backfill land in the same squash.

Per the root rules: do **not** run `yarn db:migrate` to make the generator quiet. The PR carries the migration and the snapshot.

## Frontend architecture contract

`/backend/processes` gains definition authoring, so the boundary matters.

- **Server/client boundary.** Definition list and detail render server-side; the trigger editor, milestone editor and run-now control are the only `"use client"` islands.
- **`"use client"` ledger.** `TriggerEditor` (cron validation, add/remove), `MilestoneEditor` (drag order, step picker), `RunNowButton` (guarded mutation). Each justified by interaction, not convenience.
- **Server-only imports.** The cron validator comes from the deep path `@open-mercato/scheduler/modules/scheduler/lib/cronParser`. The existing boundary test covers regressions; extend `SERVER_REACHING_PACKAGE_ROOTS` if a new package root is reached.
- **Canonical primitives.** `makeCrudRoute` with `indexer: { entityType }` for definitions; `CrudForm` for the definition form with optimistic locking auto-derived from `initialValues.updatedAt`; `DataTable` for lists; `apiCall`; `useGuardedMutation` for run-now. No raw `fetch`, no bespoke table.
- **Design system.** Status via `StatusBadge` with semantic tokens — no `text-red-*`/`bg-green-*`, no arbitrary text sizes, lucide icons only, `aria-label` on icon-only buttons, `Cmd/Ctrl+Enter` submit and `Escape` cancel in every dialog. Boy Scout rule on every touched line.
- **Milestone editor:** the child milestone rows mutate the parent definition, so the parent's optimistic-lock header applies — no per-child override is needed here (unlike a form whose `onSubmit` mutates *other* entities).

## Phasing

### Phase 1 — rename, no behaviour change

1. Rename entities, tables, ACL features, event ids, API routes, i18n keys across five locales.
2. Squash migrations to one current-state file; regenerate the snapshot.
3. `yarn generate`; update `setup.ts` `defaultRoleFeatures`; run `sync-role-acls`.

*Ships green. Nothing new, nothing lost.*

### Phase 2 — triggers become first-class

4. `processTriggerSchema`; migrate `schedule_cron` and `agent_task_event_triggers` rows into `triggers`.
5. `triggeredBy` on `ProcessRun`.
6. Manual entry gated on a declared `manual` trigger.
7. Trigger editor UI.

### Phase 3 — milestones

8. `processMilestoneSchema` on the definition; editor with ordering and a step picker.
9. Drift diagnostic in the Problems panel, reusing the workflows shape.
10. Business-facing milestone view on the process detail page.

### Phase 4 — outcome

11. Nullable `outcome` on `ProcessRun`, written on completion.
12. Rendered on process detail and linked where the target module is present — resolved soft-optionally, degrading to the label snapshot when it is not.

## Integration coverage

| Surface | Assertion |
|---|---|
| `GET/POST/PUT/DELETE /api/agent_orchestrator/process-definitions` | CRUD + tenant scoping + optimistic lock 409 |
| `POST /process-definitions/[id]/run` | 403 without a declared `manual` trigger; `triggeredBy.kind === 'manual'` recorded |
| Schedule trigger | invalid cron rejected at save, not at fire time |
| Event trigger | the declared event starts a run; a filtered-out payload does not |
| Milestones | a milestone naming an unknown step warns and stays saveable; on an agent-targeted definition it is a validation error |
| Outcome | absent outcome renders no link; present-but-missing module degrades to the label |
| `/backend/processes` | list, create, edit, run-now, milestone reorder |
| Client boundary | the guard test still passes with the new client islands |
| ACL | `processes.view` sees the list; `processes.manage` required to edit; `processes.run` to start |

## Risks

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| The squash is applied to a database that already ran the old migrations | High | Verified absent from `origin/develop`; the PR carries migration + snapshot and never runs `db:migrate`. Any fork holding these tables must drop and re-init — stated in the PR body | A fork nobody knows about; acceptable for an unreleased module |
| A rename misses a call site and fails only at runtime | Medium | `yarn generate` + typecheck catch imports and registries; i18n key sweep across five locales; integration tests cover every renamed route | Dynamic string-built ids; grep for `'agent_orchestrator.task` before merge |
| Milestone drift warnings become noise | Medium | Warning not error; scoped to workflow-targeted definitions only | Authors may ignore it — the same residual the workflows Problems panel already carries |
| Collapsing event triggers into jsonb loses per-trigger querying | Low | Nothing queries triggers across definitions today; a GIN index on `triggers` covers the event-id lookup the dispatcher needs | Revisit if cross-definition trigger search is ever needed |
| Renaming `tasks.*` ACL features locks a tenant out mid-upgrade | Low | `sync-role-acls` is additive and wildcard-aware; module unreleased | None |

## Changelog

- **2026-08-11**: Written. Gate answers: definition + run with the projection kept (the umbrella's "merge three into one" corrected — a definition and a projection cannot merge); triggers as one declared list; milestones stored with a load-bearing drift diagnostic; optional outcome; migrations squashed rather than stacked; split from W2, whose proposal envelope this consumes.
