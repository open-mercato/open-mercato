# Workflows Module — Agent Guidelines

Use the workflows module for business process automation: defining step-based workflows, executing instances, handling user tasks, processing async activities, and triggering workflows from domain events.

## Always

1. **MUST resolve services via DI** — use `container.resolve('workflowExecutor')`, never import and call lib functions directly
2. **MUST use `workflowExecutor.startWorkflow()`** to create and run instances.
3. **MUST follow the step state machine** — steps transition `PENDING → ACTIVE → COMPLETED|FAILED|SKIPPED|CANCELLED`; never set status out of order
4. **MUST follow the instance state machine** — instances transition `RUNNING → COMPLETED|FAILED|CANCELLED`; intermediate states include `PAUSED`, `WAITING_FOR_ACTIVITIES`, `COMPENSATING`
5. **MUST keep activity handlers idempotent** — check state before mutating; activities may be retried on failure
6. **MUST use event sourcing** — log all workflow events via `eventLogger.logWorkflowEvent()`; never mutate instance state without a corresponding event
7. **MUST use variable interpolation** for dynamic activity config — use `{{context.*}}`, `{{workflow.*}}`, server-allowlisted non-secret `{{env.*}}` keys such as `{{env.APP_URL}}`, and `{{now}}`; never hardcode values or read secrets from `{{env.*}}`
8. **MUST use event triggers, signals, and widget injection** for cross-module integration.
9. **MUST declare new events in `events.ts`** with `as const` — undeclared events trigger TypeScript errors and runtime warnings
10. **MUST scope all queries by `organization_id`** — workflow data is tenant-scoped; never expose cross-tenant instances or tasks

## Ask First

- Ask before changing workflow, step, or activity state machines.
- Ask before changing SSRF guard behavior, private URL allowances, compensation semantics, or trigger storm controls.
- Ask before coupling another module directly to workflow internals.

## Never

- Never import and call workflow lib functions directly instead of resolving DI services.
- Never skip the execution loop or insert `WorkflowInstance` rows directly.
- Never mutate instance state without a corresponding workflow event.
- Never expose cross-tenant workflow instances or tasks.
- Never leave `OM_WORKFLOWS_ALLOW_PRIVATE_URLS` enabled in production.

## Validation Commands

```bash
yarn db:generate
yarn generate
yarn workspace @open-mercato/core build
```

## Execution Architecture

```
Definition → startWorkflow() → Instance → executeWorkflow() loop
                                              ↓
                                    stepHandler.enterStep()
                                              ↓
                              ┌─────────┬─────────┬──────────┐
                           USER_TASK  AUTOMATED  WAIT_FOR_*  END
                              ↓         ↓          ↓          ↓
                           (pause)   transition  (pause)   complete
                                        ↓
                              transitionHandler.executeTransition()
                                        ↓
                              activityExecutor (sync or async)
                                        ↓
                                   next step...
```

- **Sync activities** execute inline and advance the workflow immediately
- **Async activities** enqueue to the `workflow-activities` queue; workflow pauses until the worker completes them and calls `resumeWorkflowAfterActivities()`
- **Compensation** follows the saga pattern — on failure, compensation activities execute in reverse order

## Data Model Constraints

- **WorkflowDefinition** — templates with steps, transitions, triggers, activities. MUST have a unique `workflowId` + `version` pair
- **WorkflowInstance** — running executions. MUST reference a valid definition; MUST track `currentStepId` and `context`
- **StepInstance** — individual step executions. MUST reference parent instance; MUST record `inputData`/`outputData`
- **UserTask** — human-in-the-loop tasks. MUST have `assignedTo` or `assignedToRoles`; MUST respect `dueDate` for SLA tracking
- **WorkflowEvent** — immutable audit log. MUST NOT be updated or deleted after creation
- **WorkflowEventTrigger** — maps domain events to workflow starts. MUST specify `filterConditions` and `contextMapping`
- **WorkflowDefinitionDraft** — per-user editor autosave (`workflow_definition_drafts`, unique per definition+user+tenant). Served by `api/definitions/[id]/draft` (GET/PUT/DELETE, gated on `workflows.definitions.edit`); MUST NOT mutate the definition or its optimistic lock — only explicit Save does

## Step Types

| Step type | When to use |
|-----------|-------------|
| `START` | Entry point — every definition MUST have exactly one |
| `END` | Terminal step — marks workflow as COMPLETED |
| `USER_TASK` | When human approval or data entry is required — pauses until task completion |
| `AUTOMATED` | When the step should execute transition activities immediately and advance |
| `SUB_WORKFLOW` | When invoking a nested workflow definition |
| `WAIT_FOR_SIGNAL` | When the workflow must pause for an external signal (e.g., payment confirmed) |
| `WAIT_FOR_TIMER` | When the workflow must pause for a duration |
| `WAIT_FOR_CONDITION` | When the workflow must pause until a predicate over the run context holds — mandatory `timeout` with `onTimeout: 'FAIL'\|'CONTINUE'`, event-driven wake plus a polled backstop |
| `PARALLEL_FORK` / `PARALLEL_JOIN` | When splitting/merging parallel execution paths |

## Activity Types

| Activity type | When to use |
|---------------|-------------|
| `SEND_EMAIL` | Send templated email via mail service |
| `CALL_API` | Call an internal API endpoint |
| `CALL_WEBHOOK` | Call an external HTTP endpoint (SSRF-guarded via `@open-mercato/shared/lib/url-safety`; `redirect: 'manual'`, 3xx rejected) |
| `UPDATE_ENTITY` | Mutate an entity via the command bus |
| `EMIT_EVENT` | Emit a domain event to the event bus |
| `EXECUTE_FUNCTION` | Run a registered custom function |
| `WAIT` | Delay execution for a configured duration |
| `SET_VARIABLE` | Write values into workflow context at dot paths (assignments land at top-level context, not namespaced under the activity) |

## Context Backbone (contextSchema · ledger · picker · samples · test step)

- **`contextSchema`** — optional definition field declaring typed workflow inputs (`{ input: { fields: [{ name, type, label?, required?, options? }] } }`, same field vocabulary as `userTaskConfig.formSchema`). Edited via the definition panel's Context section; feeds the ledger's START entries (`required` → `always`, else `maybe`). Additive — absent stays absent through save round-trips.
- **`contextSchema` is CANONICAL; `definition.io.inputs` is a read-through alias** — the sub-workflow port contract (`definition.io`, `workflowIoContractSchema`) shares the same field vocabulary. When a definition declares no `contextSchema.input`, the ledger reads `io.inputs` through as its START entries (source label `io.inputs (read-through)`); when both exist, `contextSchema.input` wins. Full `@deprecated` dual-emit for `io.inputs` is deliberate follow-up work — only the ledger read-through ships today. The visual editor carries BOTH `contextSchema` and `io` as pass-through state so neither is stripped by save, drag-autosave, or draft round-trips (`lib/definition-payload.ts`).
- **Context ledger** — `lib/context-ledger.ts` is PURE (no React/ORM/DI/registry imports): `computeContextLedger` derives per-step incoming entries `{path, type, presence: always|maybe, source, sample?}` as a topological fixpoint over the graph (joins degrade presence to `maybe`; cycles tolerated). Output-contract resolution is an injected seam: the server injects `resolveServerOutputContract` (`lib/server-output-contract.ts` — activity registry + `commandRegistry.outputSchemaOf` + `flattenSchemaToContract` from `lib/ledger-schema-flatten.ts`); the browser never resolves contracts locally, it consumes the API response.
- **Engine facts (verified — never model these as available):** AUTOMATED steps' sync activity outputs land only in `stepInstance.outputData`, never `instance.context`; SUB_WORKFLOW `outputMapping` results likewise stay in `stepInstance.outputData` and are never merged into `instance.context`. The ledger deliberately advertises neither. Transition-activity sync outputs DO persist (namespaced under `activityName || activityType`), async outputs land under `${activityId}_result` at resume, SET_VARIABLE writes land at its dot paths.
- **INVOKE_AGENT is the verified exception** to the AUTOMATED rule: its result IS merged top-level into `instance.context` on every resolution path (step-handler inline branch, `activity-worker-handler` parked resume, agent_orchestrator human dispose → `sendSignal`). The ledger models it as a producer (source kind `invokeAgent`, all entries `maybe` because which keys land is path-dependent): `outputMapping` target keys when declared (machine paths only, `mapAgentResultToContext`), typed from each mapping's source path against the INVOKE_AGENT envelope (`kind`/`disposition`/`agentId`/`proposalId` plus the selected agent's OUTCOME under `data.*` for informative agents or `proposalPayload.*` for actionable ones) — resolved server-side through the OPTIONAL peer's `agentWorkflowBridge.listAgentOutcomeContracts()` warmed by `ensureWorkflowAgentOutcomeContracts`, `unknown` when the peer is absent; otherwise the legacy fixed keys `agentId`/`agentProposalId`/`<stepId>_agent`; plus, regardless of mapping, the human-dispose keys `disposition`/`proposalId`/`stepId`/`proposalPayload` and the `sendSignal` envelope keys `signal_<signalName>_payload`/`_receivedAt` (`signalConfig.signalName`, default `agent_orchestrator.proposal.ready`).
- **Context-schema API** — `GET api/definitions/[id]/context-schema` (`?stepId=` narrows; feature `workflows.definitions.view`) serves the server-computed ledger; same id forms as the definition GET (UUID, `code:<workflowId>`, synthetic uuid).
- **Variable picker + ref warnings** — `lib/expression-refs.ts` (pure) extracts `{{context.*}}` refs and checks them against the ledger; misses surface as Problems-panel WARNINGS, never blocking. `VariablePickerButton` (fed by the API ledger) inserts `{{path}}` at the cursor in activity config fields, mapping value cells, and trigger expressions.
- **Input data panel + drag-to-insert** — `components/InputDataPanel.tsx` docks the SAME grouped listing (shared helpers in `lib/ledger-entry-display.ts`) beside the node/edge edit dialogs, with samples from `lib/sample-resolver.ts`. Rows are draggable buttons: the drag carries `text/plain` = `{{path}}` (native drop into any input) plus the private `application/x-om-ledger-path` MIME (`lib/ledger-drag.ts`) that template-capable fields intercept via `ledgerDropTargetProps` to insert at the caret in their own mode (`'bare'` for mapping cells). Click and drag are both first-class; drag is an enhancement over the button/keyboard path, never the only way in.
- **Samples** — `metadata.editor.samples` (`record(stepId, { pinnedAt, source: manual|test, data })`, total ≤64KB via `WORKFLOW_EDITOR_SAMPLES_MAX_CHARS`). Samples are NOT redacted or encrypted — pinned data is stored verbatim in definition metadata; keep the warning copy wherever pinning is offered. Precedence: pin > last test output > ledger placeholder (`lib/sample-resolver.ts`, pure).
- **Test step** — `POST api/definitions/[id]/test-step` (feature `workflows.definitions.test_run`, dependsOn `definitions.edit`) is MOCK-FIRST: it never calls `entry.execute`. Registry `mock` is `((config, ctx) => unknown) | 'refuse'`; `'refuse'` or a missing mock returns 200 `{ refused: true, reason }`. Config is interpolated via the exported `interpolateVariables` against the caller-supplied sample context.

## Error Routing (routes · directives · workflow-level handler)

Spec §5.9. Everything here is additive and optional: a definition declaring none of it fails exactly
as it always did (guarded by a regression test in `lib/__tests__/error-routing.test.ts`).

- **`lib/error-routing.ts` is PURE and is the single decision point.** `resolveStepFailureHandling`
  answers, in precedence order: wired **error route** → step **`errorDirective`** → definition-level
  **`errorHandler.stepId`** → `fail`.
- **Error route** = a transition with `kind: 'error'`. It is reachable ONLY from a failure: every
  normal-routing lookup (`findValidTransitions`, the executor's auto pre-check, `evaluateTransition`'s
  auto-select, the fork/join graph walk) filters through `excludeErrorTransitions`. Following one
  publishes the failure into `context.__error` (a RESERVED context key) and logs `ERROR_ROUTED`. In a
  parallel branch the route is followed with the branch token, so a handled branch failure never
  reaches the instance.
- **`errorDirective`** on a step: `fail` (default) · `continueWithFallback` · `failureQueue`.
  `continueWithFallback` is the directive form of the transition's legacy `continueOnActivityFailure`
  flag — that flag is untouched and byte-compatible; the directive additionally writes
  `fallbackValue` into context under the failing step's id. A failed step instance is NEVER flipped
  back to COMPLETED; the instance advances while the step stays FAILED.
- **`failureQueue`** parks the instance: existing `PAUSED` status + engine-owned
  `metadata.attention` marker + `ERROR_PARKED`. No new instance status, and compensation does not run
  because the run is suspended, not terminated. `GET /api/workflows/instances?attention=true` lists
  them; the triage UI is Phase 5.
- **Workflow-level handler** (`definition.errorHandler`, exactly one form) is an ENGINE CONSTRUCT —
  never an event trigger (the trigger subscriber excludes `workflows.*` by design).
  - `{ stepId }`: last-resort in-instance jump — the executor writes `__error`, moves the cursor and
    executes the handler step (`ERROR_HANDLER_STARTED`). A step never jumps to itself, which is that
    form's recursion guard.
  - `{ workflowId, version? }`: catch-all. `completeWorkflow`'s FAILED branch schedules it **before**
    compensation (so the snapshot is pre-compensation and it still runs when compensation throws),
    logging `ERROR_HANDLER_SCHEDULED` inside the failing transaction and enqueueing a
    `workflow_error_handler` job. The worker starts it as a sub-workflow with initial context
    `{ failedStepId, error, contextSnapshot }` on its own connection. Recursion guard:
    `metadata.errorHandler.depth` (engine-owned — never `context`, which the context PATCH API
    exposes), capped by `WORKFLOW_MAX_ERROR_HANDLER_DEPTH = 1`; over the cap logs
    `ERROR_HANDLER_SKIPPED`.
- Design rationale and the ordering/durability/recursion/branch decisions:
  `.ai/runs/2026-07-27-workflows-ux-phase2b-3/DESIGN-error-handler.md`.

## Route Identity & Edit Safety

- **Transition ids are opaque and durable.** `generateTransitionId()` mints `t_<unique>`; it no longer
  derives ids from endpoints. Legacy `e_<from>_<to>` ids stay valid forever — stored definitions,
  `examples/`, and templates keep their ids through load/save, and the engine treats every transition
  id as an opaque string (`pendingTransition`, `WorkflowBranchInstance.branchKey`). MUST NOT rewrite
  stored ids outside Customize.
- **Structural edits need a new version.** A `WorkflowInstance` pins `definitionId` and the engine
  re-reads that row on every advance, so `PUT /api/definitions/[id]` refuses a topology change while
  instances are executing. `lib/definition-edit-safety.ts` (PURE) owns the decision: topology =
  step ids + step types + fork/join wiring + transition ids/endpoints/`kind`. Labels, positions,
  activity config, conditions, priorities, triggers and metadata are NOT structural and always save
  in place. Active statuses: `RUNNING`, `PAUSED`, `WAITING_FOR_ACTIVITIES`, `FORKED`, `COMPENSATING`.
  The refusal is a structured 409 (`code: WORKFLOW_STRUCTURAL_EDIT_REQUIRES_NEW_VERSION`) naming the
  publish endpoint as the remedy; the Studio surfaces it as a banner whose "Create version" mints the
  next version and re-applies the rejected edit there.
- The guard fires on the definition PUT only. The per-user draft route
  (`api/definitions/[id]/draft`) is never blocked — work-in-progress must stay saveable.
- **Reattachment rides on those durable ids.** Dragging a route endpoint onto another node
  (`onReconnect` → `lib/edge-reattachment.ts`, PURE) re-targets the transition and keeps its
  `transitionId`, label, condition, activities, priority and `kind`. Refusals return a code the
  Studio translates and the edge list is left untouched, which is what snaps the endpoint back:
  self-loop, duplicate route, data-mapping link, an error route moved off a step that can raise one,
  or any graph / fork-join violation the graph does not already have. Reattaching a fork branch
  changes which steps that branch visits, and `WorkflowBranchInstance.branchKey` is the transition
  id — keeping the id is what makes the canvas edit safe, and the edit-safety guard still refuses
  the SAVE while instances are active, so mid-flight runs never see the new wiring.

## Step Type Conversion

- `lib/step-type-conversion.ts` (PURE) owns "Change type…" (spec §4.5). It speaks the EDITOR's node
  types, not the `stepType` enum, because `invokeAgent` compiles to an AUTOMATED step and converting
  between the two is a real conversion the enum cannot express.
- **Always preserved:** the step id, its position and all of its wiring (the conversion never touches
  nodes or edges other than the one being converted), plus `label`/`stepName`, `description`,
  `timeout`, `retryPolicy` and `errorDirective`.
- **Mapped where the types genuinely share semantics:** the activity list between `automated` and
  `invokeAgent`; `signalConfig` between `invokeAgent` and `waitForSignal`; and the "give up after"
  deadline between `waitForSignal` (`signalConfig.timeout`) and `waitForCondition` (`config.timeout`).
  WAIT_FOR_TIMER's `duration` is deliberately NOT a deadline — it is how long to wait on purpose.
- **Everything else is quarantined, never dropped:** it lands in `node.data.unmappedConfig`, is
  persisted as `step.metadata.unmappedConfig` (an editor-owned bag the engine never reads), renders as
  a collapsed read-only drawer in `NodeEditDialogCrudForm`, and raises the `unmappedStepConfig`
  Problems WARNING. Converting back recovers it, which is precisely why nothing may be discarded.
- **START and END are not convertible** (in either direction): `validateWorkflowGraph` requires
  exactly one START and at least one END, so converting either breaks an invariant that is invisible
  from the inspector.

## Canvas Arrangement

- **Manual placement always wins until explicit Tidy.** `graphToDefinition(..., { includePositions: true })`
  writes each node's `_editorPosition`; `definitionToGraph` prefers a stored position and dagre-places
  (LR) only the steps that lack one. `applyAutoLayout` (the Tidy button) is the ONE place that
  overwrites an author's arrangement. Every persistence path — explicit Save, the quiet definition
  autosave, and the per-user draft — uses the same `includePositions` payload builders, so a drag
  survives a save, a draft restore, and a reload identically.
- **A drag persists once, on drag end.** `WorkflowGraphImpl` classifies each React Flow change batch
  (`WorkflowGraphNodesChangeMeta`) and hands the page `persistable: false` for in-flight drag frames,
  selections and measurements. The quiet autosave additionally skips a PUT whose body is byte-equal to
  the last one it wrote, so no interaction bumps the optimistic-lock token for nothing.
- **New nodes land deliberately.** `lib/node-placement.ts` (PURE) resolves the position: the cursor
  when a drop position is supplied (drag-from-palette), otherwise after the right-most card, nudged
  down until it clears every existing card.
- **Scoped re-tidy is deliberately NOT implemented.** Spec §4.1 allows "re-tidy only the affected
  region" on a structural mutation; re-running dagre over an inserted node's neighbourhood cannot be
  bounded without moving nodes outside the region (dagre re-ranks the whole component it is given).
  Until insert-on-edge exists there is no call site either. Placement + collision avoidance covers the
  real need; full Tidy stays explicit.

## Environment

| Variable | Effect | Default |
|----------|--------|---------|
| `OM_WORKFLOWS_ALLOW_PRIVATE_URLS` | When `1`/`true`/`yes`, bypasses the SSRF guard in `CALL_WEBHOOK` so workflow authors can hit `localhost`, RFC1918, and `.internal` targets. For dev only — MUST remain unset in production. | unset (guard enforced) |
| `OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS` | Hard cap on WAIT_FOR_CONDITION poll re-enqueues; reaching it forces `CONDITION_TIMED_OUT` so a never-satisfiable predicate cannot saturate the queue. | `1000` |
| `OM_WORKFLOWS_ENV_INTERPOLATION_ALLOWLIST` | Comma-separated non-secret process env keys allowed for `{{env.*}}` interpolation in workflow activity config. `APP_URL` is always allowed. Never include secrets. | unset (`APP_URL` only) |

## DI Services

| Token | When to use |
|-------|-------------|
| `workflowExecutor` | Start, advance, cancel, retry, and resume workflows |
| `stepHandler` | Enter/exit/execute individual steps (called by executor) |
| `transitionHandler` | Find valid transitions and execute them (called by executor) |
| `activityExecutor` | Execute or enqueue activities (called by transition handler) |
| `conditionHandler` | Evaluate and wake WAIT_FOR_CONDITION waiters (`evaluateWaitCondition` from the queue backstop, `wakeConditionWaiters` from a context write) |
| `eventLogger` | Log workflow events for audit trail |

## Adding a New Activity Type

Activity types are registry-driven: one `ActivityTypeEntry` carries dispatch, validation, form spec, async capability, and dry-run behavior. The definition-schema enum, editor pickers, and OpenAPI derive from the registry (`activityTypeIds()` / `listActivityTypes()`) — there is no enum or hardcoded UI list to edit.

1. Register one `ActivityTypeEntry` — built-ins live in `lib/activity-types.ts`; extensions call `registerActivityType` from `lib/activity-registry.ts`. Keep the registering module UI-safe: never import (not even dynamically — Turbopack chunks dynamic imports into the client bundle) a server-only executor from it; reach the executor through a runtime binding seam the server side sets up, as `lib/activity-types.ts` does with `bindActivityExecutor` (bound by `lib/activity-executor.ts` at load).
2. Add the config zod schema in `data/activity-config-schemas.ts` and pass it as `configSchema` — per-type config validation surfaces as editor/API **warnings** in Phase 1 (non-blocking; strict mode is a later opt-in).
3. Add the label key `workflows.activities.types.<ID>` to all four locales in `i18n/`.
4. Declare `form: ActivityFormFieldSpec[]` hints (components resolved from `components/fields/`); the JSON editor stays available as the collapsed "Advanced" escape hatch on every type.
5. Honor the sync/async contract: `async: { capable: true }` or `{ capable: false, reason }` — non-capable types are refused at enqueue time; optional `executeAsync` (worker-side variant) and `enqueueDelayMs(config)` for delayed queueing.
6. Optional: `mock` — `((config, ctx) => unknown) | 'refuse'` — powers the mock-first Test step (`'refuse'` and missing mocks return structured refusals; side-effecting types return would-do payloads like `{ sent: false, simulated: true }`), and `outputContract` for the context ledger (UPDATE_ENTITY resolves it via `commandRegistry.outputSchemaOf(commandId)`, degrading to `'unknown'`).
7. Test with both sync and async execution modes.

Editor picker registries (both keep free-text fallback): UPDATE_ENTITY only executes commands declared via `registerWorkflowSafeCommands` (`lib/workflow-safe-commands.ts`; `listWorkflowSafeCommands()` backs `GET /api/workflows/commands`); EXECUTE_FUNCTION's picker lists `registerWorkflowFunctions` descriptors (`lib/workflow-function-registry.ts`).

## Adding a New Step Type

1. Add the type to the `StepType` enum in `data/entities.ts`
2. Add a handler case in `lib/step-handler.ts` → `executeStep()`
3. Create a React Flow node component in `components/nodes/`
4. Register the node in the visual editor's node type map
5. Add i18n labels in `i18n/en.json` under `workflows.stepTypes`
6. Add icon mapping in `lib/node-type-icons.ts`
7. Run `yarn generate`

## Event Triggers

Configure automatic workflow starts from domain events:

1. Add trigger configuration to a workflow definition's `triggers[]` array
2. The wildcard subscriber (`subscribers/event-trigger.ts`) evaluates all non-internal events
3. Excluded event prefixes: `query_index`, `search`, `workflows`, `cache`, `queue`
4. Configure `filterConditions` to narrow which events match
5. Configure `contextMapping` to extract event payload into workflow context
6. Use `debounceMs` and `maxConcurrentInstances` to prevent trigger storms

## Widget Injection

The module injects an order-approval widget into the sales module:

- Widget: `widgets/injection/order-approval/`
- Spot ID: `sales.document.detail.order:details`
- Mapping: `widgets/injection-table.ts`

When adding new injected widgets, follow this pattern — keep the widget self-contained with a server component (`widget.ts`) and client component (`widget.client.tsx`).

## Key Directories

| Directory | When to modify |
|-----------|---------------|
| `api/` | When adding/modifying REST endpoints for definitions, instances, tasks, events, signals, templates, per-user drafts |
| `backend/` | When changing admin pages (definition list, visual editor, instance viewer, task inbox) |
| `components/` | When modifying the visual workflow editor (React Flow nodes, edges, dialogs) |
| `data/` | When changing ORM entities, validators, or extensions |
| `examples/` | When adding/updating seed workflow definitions (JSON) or gallery templates (`examples/templates/*.json`; each MUST validate against `workflowDefinitionDataSchema` — a test enforces it) |
| `frontend/` | When modifying public-facing workflow pages |
| `i18n/` | When adding/updating translations (en, es, de, pl) |
| `lib/` | When changing core engine logic (executor, handlers, compensation, signals) |
| `subscribers/` | When adding event-driven side effects (trigger evaluation, notifications) |
| `widgets/` | When adding cross-module UI injection (e.g., approval widgets) |
| `workers/` | When modifying the async activity worker |

## Structure

```
src/modules/workflows/
├── acl.ts                    # 19 RBAC features
├── ce.ts                     # Custom entities (empty)
├── cli.ts                    # CLI: seed-demo, start-worker, process-activities
├── di.ts                     # DI: workflowExecutor, stepHandler, transitionHandler, activityExecutor, eventLogger
├── events.ts                 # 22 typed events (CRUD + lifecycle)
├── index.ts                  # Module metadata
├── notifications.ts          # Task assignment notification
├── setup.ts                  # Tenant init: seed examples, default role features
├── api/                      # REST endpoints (definitions, instances, tasks, events, signals)
├── backend/                  # Admin pages (visual editor, instance viewer, task inbox)
├── components/               # React Flow visual editor components
├── data/                     # ORM entities, validators, extensions
├── examples/                 # Seed workflow definitions (JSON)
├── frontend/                 # Public pages (checkout-demo)
├── i18n/                     # Translations (en, es, de, pl)
├── lib/                      # Core engine (executor, step/transition/activity handlers, compensation, signals)
├── migrations/               # Database migrations
├── subscribers/              # Event trigger evaluator, task notification
├── widgets/                  # Injected widgets (order-approval)
└── workers/                  # Async activity worker (workflow-activities queue)
```

## Cross-References

- **Event bus architecture**: `packages/events/AGENTS.md`
- **Queue worker contract**: `packages/queue/AGENTS.md`
- **Business rules engine**: `packages/core/src/modules/business_rules/`
- **Widget injection pattern**: `packages/core/AGENTS.md` → Widget Injection
- **Module setup convention**: `packages/core/AGENTS.md` → Module Setup Convention
