# The Triggered Process Model (W1)

**Date:** 2026-08-11 · **Status:** implemented (all four phases; see Changelog)
**Umbrella:** [`2026-08-10-pre-release-remediation-plan.md`](./2026-08-10-pre-release-remediation-plan.md) — workstream W1
**Companion:** [`2026-08-11-agent-taxonomy.md`](./2026-08-11-agent-taxonomy.md) (W2) owns the proposal envelope this consumes.
**Ordering:** independent in scope; W2 carries its own migration rather than folding into this squash, so neither waits on the other. If W2 lands first, this squash absorbs its columns.
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

Entity classes are prefixed `Agent*`, matching every other class in the module and keeping them distinct from core `workflows`' `WorkflowDefinition`. "Which one is *the* process" is the ambiguity this spec exists to remove, so the projection keeps the bare name and the two authored records are explicit about what they are:

```
AgentProcessDefinition     ← agent_task_definitions + agent_task_event_triggers
  id, name, description
  target: { kind: 'agent' | 'workflow', agentId? , workflowId? }
  inputSchema, inputDefaults
  executionPrincipalId, grantedFeatures
  triggers: ProcessTrigger[]        ← NEW: one list, three kinds
  milestones: ProcessMilestone[]    ← NEW
  enabled

AgentProcessRun            ← agent_task_runs
  definitionId, triggeredBy: { kind, ref? }
  status, input, startedAt, completedAt
  outcome: { type, id, label } | null   ← NEW, nullable

AgentProcess               ← unchanged projection
  rebuilt from events over AgentProcessRun; still the read model
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
    /**
     * Exact id OR a trailing-wildcard pattern (`claims.*`) — the shape
     * `agent_task_event_triggers.event_pattern` already accepts. Naming this
     * `eventId` would have silently dropped wildcard subscription.
     */
    eventPattern: z.string().min(1),
    /** The `WorkflowEventTriggerConfig` shape, carried over verbatim. */
    config: z.object({
      filterConditions: z.record(z.string(), z.unknown()).optional(),
      /** How the event payload becomes run input. Without it an event-triggered run has NO input. */
      contextMapping: z.record(z.string(), z.string()).optional(),
      debounceMs: z.number().int().min(0).optional(),
      maxConcurrentInstances: z.number().int().min(1).optional(),
    }).optional(),
    /** Order among triggers matching the same event. */
    priority: z.number().int().default(0),
    enabled: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('manual'),
    /** Features a caller needs beyond `processes.run` to start it by hand. */
    requireFeatures: z.array(z.string()).default([]),
  }),
])
```

**Nothing is dropped in the collapse.** An earlier draft of this spec modelled the event trigger as `{ eventId, filter }` and called the table's removal lossless. It is not: `agent_task_event_triggers` carries a wildcard-capable `event_pattern`, a `config` holding `contextMapping` / `debounceMs` / `maxConcurrentInstances`, and a `priority` (`data/entities.ts:1384-1422`). Losing `contextMapping` alone would leave every event-triggered run with no input. All four move across.

- **`schedule`** absorbs `schedule_cron` / `schedule_timezone` / `schedule_enabled`. Validation stays `validateCronExpression` from `@open-mercato/scheduler/modules/scheduler/lib/cronParser` — the **deep import**, never the package root, which reaches server-only code and breaks the client bundle (guarded by `__tests__/client-server-boundary.test.ts`).
- **`event`** absorbs `agent_task_event_triggers` rows with every field intact. The table collapses into the definition's jsonb because it has no lifecycle of its own — a trigger without its definition is meaningless — not because its columns were surplus.
- **`manual`** makes the existing run route a declared capability rather than an undocumented one. A definition with no `manual` trigger cannot be started by hand — today every definition can, silently.

`AgentProcessRun.triggeredBy` records which fired: `{ kind: 'schedule' }`, `{ kind: 'event', ref: <eventId> }`, `{ kind: 'manual', ref: <userId> }`. Today `agent_task_runs` cannot answer "why did this run".

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
| `/backend/agentic-tasks` | `/backend/processes/definitions` (list + authoring) |
| `/backend/processes` | unchanged — still the **projection** list of running processes |
| `/api/agent_orchestrator/tasks*`, `/task-runs*` | `/api/agent_orchestrator/process-definitions*`, `/process-runs*` |

`agent_orchestrator.processes.view` already exists (`acl.ts:96`) for the projection surface; `tasks.view` merges into it rather than adding a fourth feature. `defaultRoleFeatures` in `setup.ts` updates in the same change, and `yarn mercato auth sync-role-acls` runs for existing tenants.

**The one surface that does not move:** core `workflows` keeps `/backend/tasks`, its bridge redirect, and the frozen `workflows.tasks.list` tableId that the enterprise Caseload row action binds to. W1 renames the *enterprise* task concept; the core user-task one is released and untouched.

### Encryption: the rename must move the map with it

`encryption.ts` keys its `defaultEncryptionMaps` entries by a **string** `entityId`:

```ts
{ entityId: 'agent_orchestrator:agent_task_definition', fields: ['input_defaults'] }
{ entityId: 'agent_orchestrator:agent_task_run',        fields: ['input', 'failure_reason'] }
```

Nothing type-checks that string. Rename the entities without renaming these and the maps stop matching: `input`, `input_defaults` and `failure_reason` — all of which can carry claimant data, contact details and free text about people — begin persisting in **plaintext**, and every previously-encrypted row becomes unreadable. It fails silently, in green CI. This is the single highest-consequence line in the rename.

So the rename carries:

| Map entityId | Becomes |
|---|---|
| `agent_orchestrator:agent_task_definition` | `agent_orchestrator:agent_process_definition` |
| `agent_orchestrator:agent_task_run` | `agent_orchestrator:agent_process_run` |

and Phase 1 ships a test that asserts every `defaultEncryptionMaps` entityId resolves to a registered entity — a guard, because the next rename will have the same hole. Reads stay on `findWithDecryption` / `findOneWithDecryption`; no call site changes.

### Migrations: squash, do not stack

The module's snapshot already fails to record `agent_eval_case_runs`, `agent_eval_suite_runs`, `agent_eval_results.eval_case_run_id`, `agent_proposals.source` and `agent_runs.source`, so `yarn db:generate` emits non-idempotent DDL today. Stacking an alter-heavy rename chain on top makes it worse.

Replace the module's migrations with **one current-state migration** and regenerate `migrations/.snapshot-open-mercato.json` from it. It clears the W4 defect in passing. If W2 has already landed, its `selected_option_id` and `agent_type` columns are absorbed into the squash and its alter is deleted; if it has not, the squash does not wait for it.

Per the root rules: do **not** run `yarn db:migrate` to make the generator quiet. The PR carries the migration and the snapshot.

## Frontend architecture contract

`/backend/processes` gains definition authoring, so the boundary matters.

- **Server/client boundary.** Definition list and detail render server-side; the trigger editor, milestone editor and run-now control are the only `"use client"` islands.
- **`"use client"` ledger.** `TriggerEditor` (cron validation, add/remove), `MilestoneEditor` (drag order, step picker), `RunNowButton` (guarded mutation). Each justified by interaction, not convenience.
- **Server-only imports.** The cron validator comes from the deep path `@open-mercato/scheduler/modules/scheduler/lib/cronParser`. The existing boundary test covers regressions; extend `SERVER_REACHING_PACKAGE_ROOTS` if a new package root is reached.
- **Canonical primitives.** `makeCrudRoute` with `indexer: { entityType }` for definitions; `CrudForm` for the definition form with optimistic locking auto-derived from `initialValues.updatedAt`; `DataTable` for lists; `apiCall`; `useGuardedMutation` for run-now. No raw `fetch`, no bespoke table.
- **Design system.** Status via `StatusBadge` with semantic tokens — no `text-red-*`/`bg-green-*`, no arbitrary text sizes, lucide icons only, `aria-label` on icon-only buttons, `Cmd/Ctrl+Enter` submit and `Escape` cancel in every dialog. Boy Scout rule on every touched line.
- **Two routes, not one tabbed page.** `/backend/processes` keeps listing running processes (the projection); `/backend/processes/definitions` is where definitions are authored. They answer different questions — "what is happening now" versus "what can happen" — and merging them behind tabs would rebuild the task/process confusion this spec removes. `/backend/agentic-tasks` redirects to the definitions route for one release of muscle memory, then goes.
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
6. Manual entry gated on a declared `manual` trigger. **The step-4 migration must synthesize a `{ kind: 'manual' }` trigger on every existing definition** — today every definition can be run by hand, so gating without the backfill silently removes run-now from all of them. Covered by an integration assertion, not left to review.
7. Trigger editor UI.

### Phase 3 — milestones

8. `processMilestoneSchema` on the definition; editor with ordering and a step picker.
9. Drift diagnostic in the Problems panel, reusing the workflows shape.
10. Business-facing milestone view on the process detail page.

### Phase 4 — outcome

11. Nullable `outcome` on `AgentProcessRun`, written on completion.
12. Rendered on process detail and linked where the target module is present — resolved soft-optionally, degrading to the label snapshot when it is not.

## Data models

| Table | Column | Type | Null | Default | Notes |
|---|---|---|---|---|---|
| `agent_process_definitions` | `triggers` | `jsonb` | yes | `'[]'` | `ProcessTrigger[]`, `.max(20)`. GIN index below |
| `agent_process_definitions` | `milestones` | `jsonb` | yes | `'[]'` | `ProcessMilestone[]`, `.max(50)` |
| `agent_process_runs` | `triggered_by` | `jsonb` | yes | — | `{ kind, ref? }` |
| `agent_process_runs` | `outcome_type` / `outcome_id` / `outcome_label` | `varchar` | yes | — | FK-id + snapshot; never a relation |

Every existing column carries over unchanged, including `tenant_id` / `organization_id` on both tables.

**Index.** The event dispatcher's access pattern changes from an indexed lookup on `agent_task_event_triggers.event_pattern` to a scan of definitions. That needs a real index, not an assertion:

```sql
create index "agent_process_definitions_triggers_gin"
  on "agent_process_definitions" using gin ("triggers" jsonb_path_ops);
```

queried with containment (`triggers @> '[{"kind":"event","eventPattern":"claims.claim.reported"}]'`). Wildcard patterns cannot be served by containment, so they fall back to a filtered scan over the (small) set of enabled definitions — acceptable at this cardinality, and stated rather than assumed.

## API contracts

| Route | Method | Shape |
|---|---|---|
| `/api/agent_orchestrator/process-definitions` | GET/POST | `makeCrudRoute` with `indexer: { entityType: 'agent_orchestrator:agent_process_definition' }`; list returns `updatedAt` for optimistic locking |
| `/api/agent_orchestrator/process-definitions/[id]` | GET/PUT/DELETE | 409 with the standard conflict body on stale `updatedAt` |
| `/api/agent_orchestrator/process-definitions/[id]/run` | POST | `403` without a declared `manual` trigger or without `processes.run`; `202` with `{ runId }` |
| `/api/agent_orchestrator/process-runs` | GET | Adds `triggeredBy`, `outcome` |

Every route exports `openApi`. Cache: definition lists are read-heavy and tenant-scoped — cached via the DI cache with tag `agent_orchestrator:process_definitions:<tenantId>`, invalidated on every definition write.

## Undo

Definition create/update/delete, trigger edits and milestone reorder all run through the command path with `before`/`after` snapshots and `emitCrudUndoSideEffects` carrying `indexer: { entityType, cacheAliases }`, so an undo refreshes the query index and the cache tag above. The outcome write is part of run completion and is **not** independently undoable — undoing a completed run's outcome without undoing the run would be a lie; stated here so an implementer does not invent one.

## Final compliance report

| Requirement | Status | Evidence |
|---|---|---|
| Singular entity naming | ✅ | `agent_process_definition`, `agent_process_run`; tables plural |
| No cross-module ORM relations | ✅ | Outcome is FK-id + label snapshot, resolved soft-optionally |
| Tenant/organization scoping | ✅ | Both tables carry and filter on both |
| Zod validation | ✅ | `processTriggerSchema`, `processMilestoneSchema` in `data/validators.ts` |
| Encryption maps | ✅ | Rename section above; guard test in Phase 1 |
| Canonical primitives | ✅ | `makeCrudRoute`, `CrudForm`, `DataTable`, `apiCall`, `useGuardedMutation` |
| Undo contract | ✅ | Section above |
| Optimistic locking | ✅ | `updated_at` on both entities; returned in list/detail; `CrudForm` auto-derives |
| BC contract surfaces | ⚠️ | Routes, ACL ids, event ids, tables all rename. Branch-only except core `/backend/tasks` + `workflows.tasks.list`, which are untouched |
| Integration coverage | ✅ | Table below |

**Non-compliant / accepted:** `agent_orchestrator.tasks.view` merges into `processes.view`, which carries `dependsOn: ['agent_orchestrator.proposals.view']` (`acl.ts:96-101`) where `tasks.view` did not. Anyone who could manage agentic tasks now transitively gains proposal read. Accepted — in this module a process and its proposals are one workflow, and the alternative is a fourth feature id for a distinction nobody makes — but it is a privilege change and is called out for the ACL review rather than left to be discovered.

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
| The squash is applied to a database that already ran the old migrations | High → **resolved** | Verified absent from `origin/develop`. **But `comerito/feat/agentic-claims-branch` carries the module and the pilot ran against it** — this is a known database, not a hypothetical fork. An earlier draft said such a database "drops and re-initialises", which is fine for a scratch DB and wrong for one holding real runs — the maintainer's own local database turned out to hold 473 runs and 63 proposals. `migrations/adopt-squash.mjs` is the third option: it applies the DELTA the squash represents over the old migrations (the rename, the W2 columns, the three data rewrites), records the squash as applied, and lets `db:migrate` continue. Idempotent, transactional, `--dry-run`, and refuses to act on a database it does not recognise | None. A fresh install runs `db:migrate` unchanged; an existing one runs the adopter once first |
| A rename misses a call site and fails only at runtime | Medium | `yarn generate` + typecheck catch imports and registries; i18n key sweep across five locales; integration tests cover every renamed route | Dynamic string-built ids; grep for `'agent_orchestrator.task` before merge |
| Milestone drift warnings become noise | Medium | Warning not error; scoped to workflow-targeted definitions only | Authors may ignore it — the same residual the workflows Problems panel already carries |
| Collapsing event triggers into jsonb loses per-trigger querying | Low | Nothing queries triggers across definitions today; a GIN index on `triggers` covers the event-id lookup the dispatcher needs | Revisit if cross-definition trigger search is ever needed |
| Renaming `tasks.*` ACL features locks a tenant out mid-upgrade | Low | `sync-role-acls` is additive and wildcard-aware; module unreleased | None |

## Changelog

### Phase 4 implemented — 2026-08-11

The optional outcome shipped; W1 is complete. No undo was invented for it — see §Undo, which says so on purpose.

- `processRunOutcomeSchema` (`{ type, id, label? }`) in `data/validators.ts`, plus `agent_process_runs.outcome_type` / `outcome_id` / `outcome_label` (varchar 150/200/200, all nullable) and `lib/tasks/outcome.ts` — the client-safe reader every surface goes through, like its `triggers.ts` / `milestones.ts` siblings. **The columns are bounded and the schema is bounded to match**: the §Outcome sketch bounds nothing and the Data models table says only `varchar`, so an over-long label would have passed zod and failed at insert.
- **`type` is deliberately NOT pattern-bounded.** Storage accepts whatever a producing module declares; `outcomeModuleId()` reads the `<module>:<entity>` prefix and simply declines to link when there is none. Refusing to persist an outcome because its type has no colon would lose the record over a formatting rule.
- **Correction — the spec never says where the outcome VALUE comes from.** "Written on completion, mirroring the existing `subject*` shape" cannot be taken literally: `subject` rides event payloads, and the `workflows.instance.*` lifecycle payload carries `{ id, tenantId, organizationId, workflowId, version, status, stepId }` and **no context at all** (`workflow-executor.ts` → `emitInstanceLifecycleEvent`). Implemented as: **the terminating source DECLARES the outcome under an `outcome` key** — the finished workflow instance's final context, or a researcher agent result's `data`. Both are read with `declaredOutcomeOf`; a malformed declaration is ignored rather than failing an otherwise successful run.
- **A `proposal` result declares no outcome, on purpose.** At run completion nothing has been produced yet — the effector creates the record after disposition, possibly days later. The spec's "a process that files a claim" example glosses over this; the honest answer is that the proposing run's outcome stays null.
- **Soft-optional resolution, in the two places it actually applies.** The WRITE path resolves the optional `workflows` peer through a local `tryResolve` in try/catch on the real DI token (`resolve('workflowExecutor')` → `getWorkflowInstance`), per `packages/core/AGENTS.md` § Cross-Module Coupling — never a hard `requires`, never an unconditional `container.resolve`; an absent peer means the run completes with no outcome. `getWorkflowInstance` is unscoped upstream, so the instance's own tenant/organization is re-checked against the run's scope before its context is read.
- **The LINK path could not use a DI `tryResolve`, and here is why.** No DI token identifies an arbitrary module by id — module DI registers services and entity classes, not module identity — so `lib/tasks/outcomeLink.ts` uses the registry's own non-throwing `tryGetModules()` inside a local `tryResolve`-shaped helper in try/catch, and matches the outcome's entity against the owning module's OWN declared `/backend/**/[id]` route. A module that is absent, unbootstrapped, or declares no matching record route yields `null`, and the reader gets the label snapshot. **Declining to link always beats guessing a URL that 404s.**
- **Resolution is SERVER-SIDE.** The module registry is server-populated, so `/api/agent_orchestrator/process-runs` (and `/process-runs/:id`) return the three raw columns plus a resolved `outcome_href`. The API contracts row saying the list "adds `triggeredBy`, `outcome`" is honoured as those columns plus that href — a client cannot answer "is the owning module installed" on its own.
- **Addition the spec did not name:** `agentProcessRunListQuerySchema` gained a `workflowInstanceId` filter. `/backend/processes/:id` is keyed by the workflow INSTANCE id (`agent_processes.process_id`); without the filter there was no way to get from a projection to the run carrying its outcome. Exactly the shape of gap Phase 3 hit with `targetWorkflowId`.
- **Rendered on TWO surfaces, not one.** `/backend/processes/:id` shows it as a header fact (the spec's "process detail"), and the definition detail's run ledger gained an Outcome column — an agent-target run has no `agent_processes` projection row at all, so the ledger is the only place its outcome can ever be seen. Both go through `components/ProcessOutcome.tsx`: an anchor when `outcome_href` is present, plain text carrying the label snapshot and a `title` hint when it is not.
- **Encryption: plaintext, decided rather than defaulted.** The compliance report does not mention these columns. They mirror `agent_processes.subject_label` — a record reference — not the free-text `subject_title` that entry encrypts, so no `defaultEncryptionMaps` entry was added and a test asserts none appears by accident.
- `Migration20260811180000_agent_orchestrator` is a FOURTH file — `…150000`, `…160000` and `…170000` are committed and untouched; a test asserts none of them mentions `outcome_`. Nothing to backfill: the outcome is optional by decision, so every historical run legitimately carries none and deriving one would be inventing a fact. Snapshot regenerated through MikroORM's own `Migrator.storeCurrentSchema` path (`schemaGenerator.getTargetSchema()`, `connect: false`, entities loaded as `packages/cli/src/lib/db/commands.ts` loads them), verified byte-identical against the committed snapshot BEFORE the entity edit to prove the offline path faithful; the diff is the three new columns.
- Tests: `__tests__/process-outcome.test.ts` (schema bounds and the optional label, the readers incl. a half-written pair, declared-outcome parsing, link resolution present/absent/unbootstrapped/no-matching-route/catch-all/id-encoding, the completion write incl. the null case, the failed case, the absent peer, the cross-scope refusal and idempotency, the executor's researcher-only read, the migration + snapshot, no ORM relation, no encryption entry, i18n across five locales) and `__tests__/process-outcome-render.test.tsx` (the real `/backend/processes/:id` page: absent outcome renders no link, a present-but-missing module degrades to the label snapshot as text, a linked outcome renders an anchor, the id fallback, and the scoped run query).
- **No undo.** Per §Undo the outcome write is part of run completion and is not independently undoable; nothing was added.

### Phase 3 implemented — 2026-08-11

Milestones shipped: the authored, ordered business stages plus the drift diagnostic that keeps their step mapping honest. Phase 4 (the optional outcome) is untouched.

- `processMilestoneSchema` (`{ id, label, stepId, order }`) + `processMilestonesSchema` (`.max(50)`, per the Data models table) in `data/validators.ts`. Unlike the trigger sketch, this one described a column that did not exist yet, so there was no persisted shape to contradict it — it was carried across as written, plus a duplicate-`id` rejection (two milestones sharing an id collapse in every keyed renderer and make a reorder ambiguous).
- **Milestones are workflow-target only, enforced as a validation ERROR** on both `agentProcessDefinition{Create,Update}Schema` (`path: ['milestones']`), mirrored client-side in the definition form's `superRefine`. `applyToEntity` additionally clears a stored list when a definition's target is switched to `agent`, so the row can never carry a list the next save would refuse.
- Entity: `agent_process_definitions.milestones` jsonb (default `'[]'`), `[OptionalProps]` entry, list projection, create/update mapping and the OpenAPI item schema. `Migration20260811170000_agent_orchestrator` is a THIRD file — `…150000` (the squash) and `…160000` (the trigger collapse) are committed and untouched; a test asserts neither mentions `milestones`. Purely additive, nothing to backfill: milestones are authored, never derived. Snapshot regenerated through MikroORM's own `Migrator.storeCurrentSchema` path (`schemaGenerator.getTargetSchema()` with `connect: false`), verified byte-identical against the committed snapshot BEFORE the entity edit to prove the offline path faithful; the diff is the one new column.
- **The drift diagnostic reuses core `workflows`' existing shape rather than inventing a second one**: `WorkflowValidationIssue` (`{ id, severity, message, nodeId?, nodeLabel? }` from `lib/collect-validation-issues.ts`) and the `{ key, fallback }` + injectable `WorkflowIssueTranslator` pattern of `FLOW_LOGIC_MESSAGE_KEYS` — the same channel that carries `outcomeRouteUnknownKind` and `unmappedStepConfig`. It is a `warning`; `collectMilestoneIssues` returns nothing when the step list is UNRESOLVED (`knownStepIds: null` — peer absent, no permission, request failed), because "we could not look" is not "the step is gone".
- **Correction to the Frontend architecture contract.** The `"use client"` ledger describes `MilestoneEditor` as "drag order, step picker". It ships with explicit up/down controls carrying `aria-label`s instead: §4.6's own rule is that every operation is reachable without a pointer, and drag-only reordering would have been the single way in. The step picker is an `Input` + `datalist` over the target workflow's declared steps (`GET /api/workflows/definitions?workflowId=…`), keeping free text — a step authored later must be nameable, which is exactly why drift is a warning.
- **Addition the spec did not name:** `agentProcessDefinitionListQuerySchema` gained a `targetWorkflowId` filter. The business-facing view on `/backend/processes/:id` has the projection's `workflowId` and needs the definition authored for it; without the filter it would have had to page the whole definition list.
- UI: the editor is used twice — as the definition form's `milestones` field (`visibleWhen` the target is a workflow) and as the detail page's own optimistic-locked section (`Cmd/Ctrl+Enter` saves, `Escape` reverts the draft). The rows mutate the PARENT definition, so the parent's lock header is the only one that travels. `/backend/processes/:id`'s stage stepper now renders the authored labels in authored order and keeps the observed-step-id stepper as the fallback, each under its own caption.
- Tests: `__tests__/process-milestones.test.ts` (`.max(50)`, duplicate ids, the agent-target validation error, a milestone naming an unknown step warning AND still validating, the unresolved-steps silence, the readers/reorder/stage helpers, the migration + snapshot, i18n across five locales), `__tests__/milestone-editor.test.tsx` (reorder through the UI, disabled end controls, the step datalist, the Problems panel, the agent-target refusal) and `__integration__/TC-AGENT-PROCDEF-004.spec.ts` (unknown step stays saveable, agent target 400s, reorder round-trips).

### Phase 2 implemented — 2026-08-11

Triggers became one declared list. Phases 3-4 (milestones, outcome) are untouched.

- `processTriggerSchema` (discriminated union on `kind`) + `processTriggersSchema` (`.max(20)`) + `processRunTriggeredBySchema` in `data/validators.ts`.
- **Correction to this spec.** The `processTriggerSchema` sketch above models `config.filterConditions` and `config.contextMapping` as `z.record(...)` maps. The persisted `agent_task_event_triggers.config` shape has always been **arrays of typed objects** — `filterConditions: [{ field, operator, value? }]` and `contextMapping: [{ targetKey, sourceExpression, defaultValue? }]` — and `lib/tasks/eventTriggerMatch.ts` reads them as arrays. The REAL shape was carried across; adopting the sketch would have dropped every stored trigger config, which is the loss this spec's own review caught once already. `__tests__/process-triggers.test.ts` asserts the map form is rejected.
- Entity: `agent_process_definitions.triggers` jsonb (default `'[]'`) + the specified `agent_process_definitions_triggers_gin` (`jsonb_path_ops`) index, declared via `@Index({ expression })`. `agent_process_runs.triggered_by` changed from `varchar(150)` provenance strings to jsonb `{ kind, ref? }`. `AgentTaskEventTrigger`, its table, its `task_event_trigger.*` events, its `/event-triggers*` routes and its DI registration are gone.
- **Correction to the Index section.** The spec states wildcard patterns cannot be served by containment and fall back to a filtered scan over enabled definitions. They can be served: `matchesEventPattern` is prefix-only and anchored at a dot, so the set of patterns that can match a given event is finite and tiny — the exact id plus one wildcard per dot position (`claims.claim.reported` → `claims.claim.reported`, `claims.*`, `claims.claim.*`). `candidateEventPatterns` enumerates it and the dispatcher issues one containment probe per candidate, all index-served, so **there is no scan at all**. `matchesEventPattern` is still re-applied to the loaded rows as the correctness backstop.
- `Migration20260811160000_agent_orchestrator` (a second file — `Migration20260811150000` is committed and untouched): adds `triggers`, migrates `schedule_*` and every live `agent_task_event_triggers` row into it, **synthesizes `{ kind: 'manual' }` on every existing definition**, converts the legacy `triggered_by` strings with a `case` expression (a bare `::jsonb` cast would abort on the first `user:<id>` row), then drops the columns, the table and creates the GIN index. Snapshot regenerated through MikroORM's own `Migrator.storeCurrentSchema` path with `connect: false`, verified byte-identical against the committed snapshot before the entity edits.
- Manual entry is gated in TWO places: the route (404/403 before the mutation guard, and the trigger's own `requireFeatures` via `rbacService.userHasAllFeatures`) and the `processes.enqueueRun` command (403, so every hand-start path converges on one gate). `triggeredBy` is `{ kind: 'schedule' }` / `{ kind: 'event', ref: <eventPattern> }` / `{ kind: 'manual', ref: <userId> }`; a `system` kind absorbs fixtures and legacy rows.
- `syncProcessSchedule` registers one scheduler job per enabled schedule trigger (slot 0 keeps the pre-Phase-2 uuid so an existing registration is not orphaned) and unregisters unused slots.
- UI: `backend/processes/definitions/TriggerEditor.tsx` — the `"use client"` island, used both as the definition form's `triggers` field and as the detail page's optimistic-locked trigger section (`Cmd/Ctrl+Enter` saves, `Escape` reverts the draft). Run-now is disabled with a caption when no manual trigger is declared. The list gained a Triggers column; the retired `detail.scheduleInvalid`/`scheduleNextRun`, `form.schedule*` and `triggers.add*`/`confirmDelete` i18n keys were removed and the new `triggers.*` set added across all five locales.
- Tests: `__tests__/process-triggers.test.ts` (persisted shape, `.max(20)`, cron rejected at save, candidate-pattern completeness, migration ordering + manual backfill, i18n), rewritten `task-event-trigger-subscriber.test.ts` (declared event fires, filtered-out payload does not, wildcards still match, debounce reads the jsonb provenance), enqueue-run 403/`triggeredBy` cases, and `__integration__/TC-AGENT-PROCDEF-003.spec.ts` (403 without a manual trigger, `triggeredBy.kind === 'manual'` recorded, and every migrated definition keeps run-now).

### Phase 1 implemented — 2026-08-11

Rename, encryption maps and the migration squash shipped; no behaviour change. Phases 2-4 are untouched.

- Entities/tables: `AgentTaskDefinition`/`agent_task_definitions` → `AgentProcessDefinition`/`agent_process_definitions`, `AgentTaskRun`/`agent_task_runs` → `AgentProcessRun`/`agent_process_runs`, FK `task_definition_id` → `process_definition_id`. `AgentProcess` untouched, as specified.
- `agent_task_event_triggers` and its `task_event_trigger.*` events deliberately KEPT — the table collapses in Phase 2, and renaming it twice would cost two migrations. Only its FK column was repointed.
- ACL `tasks.{view,manage,run}` → `processes.{view,manage,run}`, with `tasks.view` MERGED into the existing `processes.view` (three features, not four); `setup.ts` `defaultRoleFeatures` deduped in the same change.
- Events `task.*` → `process_definition.*`, `task_run.*` → `process_run.*` (`clientBroadcast` preserved). Command id `tasks.enqueueRun` → `processes.enqueueRun`; queue `agent-task-runs` → `agent-process-runs`; the `202` body key `taskRunId` → `processRunId`.
- Routes `/api/agent_orchestrator/tasks*` → `/process-definitions*`, `/task-runs*` → `/process-runs*`. Page `/backend/agentic-tasks` → `/backend/processes/definitions`, with a nav-hidden, still-RBAC-guarded bridge redirect at the old path (list AND detail). `/backend/processes` still lists the projection — the two routes stay separate.
- i18n `agent_orchestrator.tasks.*` → `agent_orchestrator.processDefinitions.*` across all five locales, keys and copy. **Correction to the spec:** four of those keys (`draftTitle`, `draftConfidence`, `draftDescription`, `reviewProposal`) were never about agentic tasks — they label the proposal widgets injected into core `workflows`' USER TASK surfaces. They moved to `agent_orchestrator.userTaskProposal.*` instead, so the frozen core surface keeps an honest namespace.
- Encryption maps moved with the entities, and `__tests__/encryption-map-entity-ids.test.ts` now resolves every `defaultEncryptionMaps` entityId AND every field name against the ORM metadata.
- 28 migrations replaced by one current-state `Migration20260811150000`, snapshot regenerated from `data/entities.ts`. It absorbs W2's columns and clears the W4 snapshot defect. W2's `to_regclass`-guarded rewrites of CORE `workflow_definitions`/`workflow_definition_drafts` rows are carried over verbatim — a create-table cannot absorb a data rewrite on a table this module does not own. The two W2 migration tests were repointed at the squash rather than deleted.
- **Not renamed, deliberately:** the `task:<id>` `agent_principals.agent_definition_id` prefix (a persisted key; moving it would orphan every provisioned principal and mint a second one per definition), and internal source paths (`lib/tasks/`, `commands/tasks.ts`, `workers/task-run-executor.ts`, `subscribers/task-*.ts`, several `__tests__` filenames) — symbols inside them were renamed.

### Review — 2026-08-11

Independent fresh-context review (checklist §1 scope cohesion + full compliance gate). Accepted and applied: the encryption-map `entityId` rename (would have silently plaintexted `input` / `input_defaults` / `failure_reason` and made existing rows unreadable, in green CI); four capabilities the trigger collapse was dropping while calling itself lossless (`event_pattern` wildcards, `contextMapping`, `debounceMs` / `maxConcurrentInstances`, `priority`); the manual-trigger backfill without which every existing definition silently loses run-now; the pilot database on `comerito/feat/agentic-claims-branch`, which the risk table had written off as "a fork nobody knows about"; entity-class prefixes; the GIN index actually written out; the `/backend/processes` route split; undo, data models, API contracts and the compliance report the repo's own gate requires.


- **2026-08-11**: Written. Gate answers: definition + run with the projection kept (the umbrella's "merge three into one" corrected — a definition and a projection cannot merge); triggers as one declared list; milestones stored with a load-bearing drift diagnostic; optional outcome; migrations squashed rather than stacked; split from W2, whose proposal envelope this consumes.
