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
yarn mercato auth sync-role-acls   # after ANY acl.ts change — existing tenants only pick up new grants here
```

Release runbook: adding a feature to `acl.ts` grants it to new tenants through
`setup.ts` `defaultRoleFeatures`, but **existing** tenants receive nothing until
`yarn mercato auth sync-role-acls` runs. Run it as part of the deploy for every
release that touches `acl.ts`.

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
- **Engine facts (verified — never model these as available):** AUTOMATED steps' sync activity outputs land only in `stepInstance.outputData`, never `instance.context`, and the ledger deliberately advertises none of them. Transition-activity sync outputs DO persist (namespaced under `activityName || activityType`), async outputs land under `${activityId}_result` at resume, SET_VARIABLE writes land at its dot paths.
- **What lands is the ACTIVITY HANDLER's return, never the command's.** `executeUpdateEntity` returns the envelope `{ executed, commandId, result, logEntryId }` and both merge paths carry it verbatim, so a command's `outputSchema` describes what sits under `result` — the ledger nests it there (`<activity>.result.<path>`). Any new `outputContract` MUST model its handler's envelope the same way; CALL_API's still flattens the endpoint response schema at the activity root while `executeCallApi` returns `{ status, statusText, headers, body, … }` with the response under `body` — a known, unfixed off-by-one-level in the same family.
- **SUB_WORKFLOW is PATH-DEPENDENT, not silent.** Its two resolution paths disagree and only one merges: a child that terminates inside the parent's own call returns the mapped output as `stepInstance.outputData` only (`handleSubWorkflowStep` → `exitStep`), but a child that PARKS on its first async/agent step parks the parent on `SUB_WORKFLOW_SIGNAL_NAME`, and the child's terminal `resume_subworkflow_parent` job maps the same output and passes it to `sendSignal`, which spreads the payload FLAT into `instance.context`. So `config.outputMapping` target keys genuinely reach the parent context on the async path — the ledger models them as a `subWorkflow` producer with every entry `maybe` (which path runs is a property of the CHILD at runtime, and the mapping drops any target whose source path is undefined) and `unknown`-typed (the source paths address the child's context, and the child's `io.outputs` contract lives on the CHILD definition the pure ledger is never given). Two real contributions stay unmodeled on purpose: with no mapping — or when no mapped source resolves — `mapOutputData` falls back to the WHOLE child context, whose keys cannot be named from the parent definition (a `'*'` wildcard would silence every downstream unresolved-ref warning, so a step declaring no `outputMapping` advertises nothing, unchanged); and `sendSignal`'s `signal_<name>_payload`/`_receivedAt` keys do land but the signal name is `workflows.sub_workflow.completed`, so the dotted flat key is unreachable through `{{context.*}}` resolution (`getNestedValue` splits on `.`).
- **INVOKE_AGENT is the verified exception** to the AUTOMATED rule: its result IS merged top-level into `instance.context` on every resolution path (step-handler inline branch, `activity-worker-handler` parked resume, agent_orchestrator human dispose → `sendSignal`). The ledger models it as a producer (source kind `invokeAgent`, all entries `maybe` because which keys land is path-dependent): `outputMapping` target keys when declared (machine paths only, `mapAgentResultToContext`), typed from each mapping's source path against the INVOKE_AGENT envelope (`kind`/`disposition`/`agentId`/`proposalId` plus the selected agent's OUTCOME under `data.*` for informative agents or `proposalPayload.*` for actionable ones) — resolved server-side through the OPTIONAL peer's `agentWorkflowBridge.listAgentOutcomeContracts()` warmed by `ensureWorkflowAgentOutcomeContracts`, `unknown` when the peer is absent; otherwise the legacy fixed keys `agentId`/`agentProposalId`/`<stepId>_agent`; plus, regardless of mapping, the human-dispose keys `disposition`/`proposalId`/`stepId`/`proposalPayload` and the `sendSignal` envelope keys `signal_<signalName>_payload`/`_receivedAt` (`signalConfig.signalName`, default `agent_orchestrator.proposal.ready`).
- **Prompt-to-draft agent self-validates + is fail-closed on INVOKE_AGENT** — the in-Studio `workflows.workflow_author` agent (spec §9) is object-mode but now allows exactly ONE read-only tool, `workflows.validate_workflow_definition` (draft-shaped, gated on `definitions.create`), run inside the runtime's `enableTools` object-mode loop (`lib/ai-draft-runner.ts` sets `enableTools: true`; a tight `loop.budget` bounds it). The tool re-runs the exact generate-route validation (`workflowDefinitionDataSchema` + `evaluateWorkflowDefinition`) so the model self-corrects a partial config (e.g. missing `INVOKE_AGENT` `config.agentId`/`onResult`) before returning; the route's post-generation `safeParse` stays the trust boundary. `buildWorkflowDraftCatalog` carries a usable-`agents` list (fed from the OPTIONAL `agentWorkflowBridge.listAgentOutcomeContracts?.()`), and `buildWorkflowDraftPrompt` FORBIDS `INVOKE_AGENT` outright when that list is empty — fail-closed, so no agent step is drafted when there is no agent to run.
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

## Agent Outcome Routing (spec §7.2)

- **`lib/outcome-routing.ts` (PURE) is the single decision point**, the third member of the family
  `lib/error-routing.ts` and `lib/breach-routing.ts` belong to. The three share the mechanical parts
  through `lib/route-kinds.ts` (`excludeNonNormalTransitions`, the handle ↔ kind round trip) and keep
  their own decision points, because their fallback vocabularies genuinely differ.
- **The handle set is spec §7.2's FIXED five disposition kinds** — `approved`, `informative`,
  `rejected`, `guardrailBlocked`, `error` — NOT the selected agent's OUTCOME-schema enum. Enumerating
  from the schema would need a per-value condition on each transition, which is exactly the context
  string-matching §7.2 exists to remove. These five are governance states; the OUTCOME schema is
  domain data.
- **Precedence** (`resolveAgentOutcomeHandling`): the step wired NO outcome route ⇒ `default`
  (today's normal routing, byte-identical for every pre-existing definition) → a wired route for this
  outcome ⇒ `route` → `approved` unwired ⇒ `default` (§7.2 renders `approved` unconditionally because
  it IS the node's ordinary output) → anything else ⇒ `inherit`, the step's `errorDirective`, which is
  the "unhandled → fail instance" the node face states.
- **Routing NEVER reads the author-visible `disposition` context key.** `lib/step-handler.ts` (inline
  resolution) and `lib/signal-handler.ts` (every parked resume — the activity worker's and the human
  dispose path alike) write the ENGINE-OWNED `__agentOutcome` marker
  (`WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY`), and `dispatchAgentOutcome` in the executor consumes it —
  clearing it first, so a route looping back through the step cannot re-fire on a stale disposition.
- **Rejection is a business route, not an error** (§7.2): a rejected proposal routes `rejected`;
  infra failure keeps the retry policy and then the `error` route. Events: `OUTCOME_ROUTED` /
  `OUTCOME_UNHANDLED`.
- **Guardrail escalation (§7.3).** A runtime guardrail `block` is recognised STRUCTURALLY
  (`isGuardrailBlockedError` — `code === 'agent_guardrail_blocked'` or `guardrailBlocked === true`),
  the same way `isRetryableError` reads `retryable: true`, so `agent_orchestrator` stays an optional
  peer core never imports. The activity worker resumes the parked step down the `guardrailBlocked`
  route **only when the step wired one**; otherwise its fail-stop is byte-identical to before, which
  is what keeps §7.3 additive. Only the guardrail CLASSIFICATION travels into the run context
  (`__guardrailBlock`: phase, kind, guardrail-set version) — never the evidence blob, per
  `agent_orchestrator/AGENTS.md`'s redaction rule.
- Author-time checks live in `validateOutcomeRoutes` (unknown outcome kind, two routes claiming the
  same kind on one step) and surface through the Problems panel.

## Agent Disposition Review & SLAs (spec §7.5)

- **The disposition task is a REAL task, built by this module.** `lib/agent-disposition-task.ts`
  owns the row `dispositionService` used to assemble inline — because this module owns the entity,
  the `USER_TASK_CREATED` audit row, the `workflows.task.assigned` event and the SLA scheduler.
  `agent_orchestrator` reaches it through a dynamic import inside its own try/catch, exactly as
  `lib/disposition/resume.ts` reaches `sendSignal`; the peer stays optional in both directions.
  Before this, the row was created unassigned — which under §6.4 is visible only to administrative
  oversight and ACTABLE BY NOBODY (`currentTaskOwnerId` is null ⇒ `ownsTheRow` false), and never
  reached the notification subscriber.
- **`invokeAgentConfigSchema.review` is the authored half** and `lib/agent-review.ts` (PURE)
  resolves it, delegating assignment to the SAME `resolveTaskAssignment` a USER_TASK uses — so an
  unresolved dynamic assignee falls back to the authored role queue here too. Resolution happens in
  the ACTIVITY EXECUTOR, against the context the step ran with, and the resolved descriptor rides
  the `invoke_agent` queue job; a definition edit while the agent runs cannot retro-change who the
  review belongs to.
- **A breached disposition deadline ESCALATES; it never decides.** `resolveAgentReviewBreachHandling`
  has no `route` arm and no verdict arm, and that absence is the feature (maintainer decision,
  2026-07-29): notify / reassign / `attention`. `applyBreachHandling` picks the vocabulary from the
  STEP's shape — an AUTOMATED step carrying an INVOKE_AGENT activity gets the escalate-only one — so
  a hand-authored `kind:'slaBreach'` transition on an agent step cannot fire either. Routing the run
  past a proposal nobody answered silently drops the proposed mutation, which is a rejection in
  everything but name, and only a human may reach a verdict. `attention` writes the engine-owned
  `metadata.attention` marker and NOTHING else — no status write, no `errorMessage`: the run is
  already parked on the proposal-ready signal, and a late reviewer is not a failed run.
- **Closing is not advancing.** `closeAgentDispositionTask` (A7) marks the row COMPLETED with a
  conditional UPDATE when the proposal is disposed. It MUST NOT go through `completeUserTask` — that
  advances the run, and the run resumes on `agent_orchestrator.proposal.ready`.
- **`workflows.task.detail:context`** (`lib/work-inbox/navigation.ts`) is the task-detail injection
  spot — FROZEN once mounted. It exists because this page can only walk a `formSchema` generically;
  the module that owns a proposal renders it in its own vocabulary (the §7.6 draft card).

## Node Outcome Rows (the canvas footer — fidelity gap #4)

- **`lib/node-outcome-rows.ts` (PURE) decides what the rows ARE**; `components/nodes/NodeOutcomeRows.tsx`
  only renders them. That split is what makes the progressive-disclosure rule testable without a
  canvas.
- **An agent node shows its WIRED outcomes plus `approved`, nothing else** (§7.2's fan-explosion
  defense — five agent nodes in a 60-node flow must stay readable), and states the inheritance
  ("unhandled → error directive") on the node face.
- **The user-task half needed NO engine work.** `taskDecisionSchema` already binds each decision to a
  durable `transitionId`, so a decision row's dot IS the route its button takes; the canvas and the
  run agree by construction.
- **The dot IS the connection handle** — wiring a disposition is drawing a line from the row that
  names it.
- **The step's DEFAULT route is the footer's last row**, `buildDefaultRouteRow()`. Its handle id is
  still `DEFAULT_SOURCE_HANDLE_ID` (`'source'`, `lib/route-kinds.ts`) — the move is presentation, so
  every stored transition keeps resolving to it. It renders as a row only when a footer renders at
  all; without one the node keeps its own `<Handle>` unchanged. It is named `default`, NOT
  `otherwise`: `resolveAgentOutcomeHandling` returns `{ kind: 'default' }` for a step that wired no
  outcome and for an unwired `approved`, while every OTHER unwired outcome inherits the error
  directive — a row promising "everything else comes here" would be wrong.
- **Every handle on the canvas is sized from `NODE_HANDLE_CLASS`** (`lib/node-geometry.ts`), footer
  dots included. MUST NOT spell `!w-3 !h-3` in a node component; `nodeHandleGeometry.test.ts` fails
  if you do. `countOutcomeRows` adds one for the default row, or dagre under-reserves the card.
- **The LABEL carries the meaning, never the dot colour** (§4.6 acceptance criterion). Two rows paint
  the same red (`rejected`, `guardrailBlocked`), which at 10px and at canvas zoom is not a
  distinction anyone can read, so every row also carries its own GLYPH and every handle is named.
  MUST NOT drop the labels for a denser rendering, and MUST NOT let the collapsed dot-only zoom
  inherit this pattern.
- Rows are derived from the committed EDGES at render time in `WorkflowGraphImpl` (like the
  compensation badges), so they never enter the document, undo, autosave or `graphToDefinition`.
  `estimateNodeSize` counts them (`NODE_OUTCOME_ROW_HEIGHT`) — a footer makes a card materially
  taller and dagre would otherwise pack ranks into each other.

## Node Config Summaries (fidelity gap #6)

- **`lib/node-config-summary.ts` (PURE) owns the card's body line.** A step states its
  CONFIGURATION — `customers.deals.update · retries 3×`, `deal_enricher · auto ≥ 0.8`,
  `role: Sales Rep · bound: 1 · 2 decisions` — not two clamped lines of the author's prose, which
  truncate mid-word and cannot say which command runs or what the threshold is.
- **Nothing new is stored.** Every value is derived from config already on the step, and
  `description` is not lost: it becomes the card's `title=` tooltip. A step with nothing configured
  produces an EMPTY summary and the card renders its description exactly as before, so no node ever
  reads emptier than it did.
- Command / function / event / agent / signal / sub-workflow ids render `font-mono`; the mockup's
  10.4px mono has no DS equivalent and is NOT reproduced — `text-xs` is the floor.

## Canvas Trigger Cap (fidelity gap #5, Direction A)

- **`lib/trigger-node.ts` (PURE) derives the model; `components/nodes/TriggerCap.tsx` renders it,
  FOLDED onto the START node.** `WorkflowGraphImpl` injects `buildTriggerNodeModel(...)` into the
  OWNED start node's render-time `data` (`data.trigger` + `data.onOpenTriggers`); `StartNode` floats
  the cap ABSOLUTELY above its pill (`bottom-full`), so the cap adds no height to the terminal and
  never enters the node's measured box. This replaces the earlier separate overlay node
  (`components/nodes/TriggerNode.tsx`, now `@deprecated`) joined by a dashed connector.
- **Why the fold, not an overlay node.** The overlay node was minted fresh every render and, being
  OUTSIDE the node state, was re-measured by ReactFlow on every render in an unbounded loop that
  pinned the CPU and starved node dragging (the canvas "teleport" bug). Injecting into the OWNED
  start node is loop-safe: its measurement is persisted to state like any real node. As defense in
  depth, `handleNodesChange` also drops changes for nodes the editor does not own
  (`lib/owned-node-changes.ts`).
- **Still display-only.** The model lives only in render-time `data`, never in the definition, so it
  is absent from the document, undo, drag autosave, the per-user draft and the subgraph clipboard by
  construction — `graphToDefinition` reads steps/edges, not `data.trigger`. Read-only viewers pass no
  `triggers`, so they render no cap.
- **NO engine change.** The triggers are already on the definition; nothing here is read by the
  executor.
- **ONE cap summarises every trigger.** Triggers are a definition-level property and every one starts
  the SAME START step. The cap shows a count (`workflows.triggerNode.capCount`) plus the manual/API
  line; the full list lives in the Triggers modal it opens. Model still capped at
  `TRIGGER_NODE_EVENT_LIMIT` (= `ROUTE_CHIP_LIMIT`), enabled first.
- **What it says must be TRUE.** `POST /api/workflows/instances` → `startWorkflow` needs no trigger,
  so the manual/API line is unconditional and a definition with ZERO event triggers still renders the
  cap. `startWorkflow` throws `DEFINITION_DISABLED` before it looks at a trigger, so a disabled
  definition's cap states ONLY that (amber `PowerOff` + label). MUST NOT draw an event trigger as the
  only way in.
- **Accessibility (spec §4.6).** The cap IS a `<button>` (`data-testid="workflow-trigger-cap"`) with
  a named `aria-label`; every state pairs its token colour with a glyph and a label — never colour
  alone. Clicking it calls `onOpenTriggers` (the Triggers modal); `stopPropagation` keeps the click
  off the step inspector.
- The old overlay-node geometry (`TRIGGER_NODE_*` in `lib/node-geometry.ts`) and helpers
  (`buildTriggerNode`, `buildTriggerEdge`, `TRIGGER_EDGE_DASH_ARRAY`, `WORKFLOW_TRIGGER_NODE_TYPE`)
  remain exported for the deprecated component and its test; they are no longer used by the editor.

## User Task Forms (`formSchema`)

- **`lib/task-form-schema.ts` is the ONE mapper** behind both form validation and rendering, and
  its type mapping is the exact inverse of the editor's. Before it existed, `validateFormData`
  walked the JSON-Schema shape while `TaskFormFields` walked `formSchema.properties`, so a
  Studio-authored form (`{fields:[…]}`) rendered NOTHING at all — adding required-field validation
  on its own would have made every Studio-authored task uncompletable.
- **`fields[].label` is OPTIONAL** (widened 2026-07-30). Every consumer already treated it that
  way — the mapper resolves `title: field.label ?? field.name` and the editor list renders
  `field.label || field.name` — while `userTaskConfigSchema` required it, which made the contract
  stricter than the code reading it. That rejected definitions the engine would have run: the AI
  draft schema (`lib/ai-authoring.ts`) and the `create_definition` MCP tool both emit an optional
  label, and the shared integration fixture never sent one, so five specs could never parse.
  An EMPTY label is still rejected — `min(1).optional()`, not `optional()` alone — because a blank
  string defeats the fallback instead of triggering it. A missing label is an authoring-quality
  issue and belongs in the Problems panel, not in a 400.
- Widening a request schema needs no deprecation window: payloads rejected before are accepted
  now, and nothing previously accepted changes. MUST NOT be re-tightened without one.

## Route Kinds (the handle ↔ `kind` round trip)

- **`lib/route-kinds.ts` (PURE) is the ONE place a non-normal route kind is registered.** It answers
  both halves of the round trip — which `kind` a connection drawn from a canvas handle compiles to,
  and which source handle a stored transition of that kind re-attaches to — and `graph-utils`
  (`graphToDefinition` + `definitionToGraph`), `lib/edge-reattachment.ts` and the Studio's
  `handleConnect` all read it. MUST NOT add a fourth inline `kind === '…'` special case.
- Registering a kind here is what makes it SURVIVE a Studio save. Before it existed only `'error'`
  was special-cased, so opening a definition carrying a `kind: 'slaBreach'` route and saving it
  silently downgraded the route to a normal transition and the breach stopped routing.
- **`kind: 'normal'` and an absent `kind` are the same thing** and both serialize as absent, which is
  what keeps a definition declaring no kinds byte-identical through a save (guarded by
  `lib/__tests__/route-kinds.test.ts`).
- A kinded route NEVER inherits its source AUTOMATED step's activity — it is not the happy path out
  of that step.
- `ROUTE_KIND_SOURCE_NODE_TYPES` (`lib/edge-reattachment.ts`) refuses moving a kinded route onto a
  node type that can never reach it (an error route off a step that cannot fail, a breach route off a
  step that carries no deadline) rather than leaving a dead route behind.

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

## Undo / Redo

- **One stack over the whole editor document.** `lib/editor-history.ts` (PURE) versions
  `{ nodes, edges, metadata }` as SNAPSHOTS — at this scale a snapshot cannot drift out of sync the
  way an inverse-command log can, and the node/edge arrays are already replaced rather than mutated,
  so an entry costs a few references. Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes, the stack caps at
  `EDITOR_HISTORY_LIMIT = 100`, and a new edit after an undo invalidates the redo branch.
- **Entries store the document as it was BEFORE the edit, plus a translated label** ("Delete step",
  "Paste"). The label is what the shortcut announces, and a later phase names AI checkpoints in the
  same stack. Because the snapshot is captured up front and committed separately, an asynchronous
  handler (anything behind a confirm dialog) commits only once the edit actually lands — a cancelled
  confirmation leaves no entry.
- **Every mutating page path commits**: inspector saves, deletes, connects, reattachment, conversion,
  drag end (one entry per drag, from the arrangement the drag started at — not per frame), sample
  pin/unpin, Tidy, paste, duplicate and palette drops. The stack lives in the page, so it survives
  dialog open/close and panel switches.
- **The definition-panel text fields are deliberately NOT versioned.** They have native input undo,
  and committing per keystroke would evict real structural edits from a 100-entry stack. The
  consequence is that a whole-document replacement — draft restore, template load, Clear canvas —
  RESETS the stack rather than pushing an entry, because undoing into it would restore the graph
  without the panel fields it was saved with.
- The shortcut is suppressed while a field has focus (the page's existing `isEditing` guard) and
  while a dialog is open, so it never hijacks form input.

## Subgraph Clipboard (copy · paste · duplicate)

- `lib/subgraph-clipboard.ts` (PURE) owns the portable format. The payload speaks the DEFINITION
  vocabulary, not React Flow's:

  ```json
  {
    "kind": "open-mercato.workflow-subgraph",
    "version": 1,
    "steps": [ /* definition steps, positions as _editorPosition */ ],
    "transitions": [ /* definition transitions, internal to the selection only */ ]
  }
  ```

  The Code view renders the definition JSON, so a fragment copied from the canvas MUST be the shape a
  fragment copied out of the Code view is — that is the whole reason the format is not nodes/edges.
  Readers refuse an unknown `kind` or `version` rather than guessing.
- **Only transitions internal to the selection travel.** A route with one endpoint outside the
  selection describes a step the payload does not carry, so pasting it could only invent a dangling
  id. Data-mapping links never travel either — their binding lives in the target step's config.
- **Paste always re-IDs** (`generateStepId` / `generateTransitionId()`) and rewires the internal
  routes onto the new ids, so pasting into the workflow a fragment came from can never collide with
  or silently merge into the original. The new step id reuses the old id's meaningful prefix with the
  generated `_<ms>_<rand>` suffix stripped, so ids stay recognisable without growing on every paste.
  Copies land offset by `SUBGRAPH_PASTE_OFFSET` and arrive selected; the paste is ONE undo entry.
- **Clipboard access can be denied** (insecure context, no permission). Copy then falls back to an
  in-page buffer and says so; paste reads that buffer. It is never a silent no-op — the reason is
  always surfaced.

## Compensation Ghosts (read-only overlay)

- **Visualization only — never an engine change.** `lib/compensation-ghosts.ts` (PURE) derives the
  spec §4.4 "dashed reverse, behind a toggle" overlay from the model the engine already executes
  (`activity.compensation.activityId`, LIFO in `lib/compensation-handler.ts`). Nothing here changes
  what runs; MUST NOT grow into editing compensation (that is an Ask-First state-machine change).
- **A route's activities run LEAVING its source step**, so the compensable step is the route's
  SOURCE (it carries the §4.3 ⛨ badge) and the undo walks back along the route, which is exactly the
  ghost edge that is minted (`target → source`). One ghost per route, however many of its activities
  compensate.
- **Ghosts never enter the document.** `WorkflowGraphImpl` mints them at RENDER time from the
  committed edges (like the validation-error node decoration), so they are absent from the edge
  state, from undo, from autosave and from `graphToDefinition` — which filters them anyway, so the
  guarantee is testable rather than merely true. They are non-interactive (not selectable,
  reattachable or deletable) so no editing gesture can reach one.
- **The overlay is off by default** and persisted per author (`om:wf-editor-compensation`), reachable
  from the toolbar and the Cmd+K palette. Its stroke uses the warning token with its OWN dash-dot
  pattern (`10,4,2,4` — distinct from pending `5,5`, error `8,4` and data-mapping `2,3`) and always
  carries an icon + label, per the never-colour-only rule.
- `graphToDefinition` now preserves `activity.compensation` through the editor round trip. It used to
  drop the field, which meant opening a compensating workflow and saving it silently deleted the
  compensation the engine relies on.

## The Form Editor Is Retired (bridge routes)

- **The Studio is the only workflow editor** (spec §10). `backend/definitions/create/page.tsx` and
  `backend/definitions/[id]/page.tsx` are BRIDGE ROUTES: their bodies are an immediate
  `router.replace` onto `/backend/definitions/visual-editor[?id=…]`, and their `page.meta.ts` guards
  are untouched so RBAC still applies exactly as before. MUST NOT delete either file — the
  deprecation protocol keeps them for ≥1 minor so bookmarks and third-party links keep working.
- **Retirement was gated on the Code view.** The spec allows retirement only once the Phase 3 Code
  view exists, because until then there was no non-canvas way to read a definition. Do not reverse
  that order if either surface is ever reworked.
- `components/formConfig.tsx` (every export), `components/StepsEditor.tsx`,
  `components/TransitionsEditor.tsx` and `components/mobile/MobileDefinitionDetail.tsx` are
  `@deprecated` and have NO call site left in this module. They stay exported for third-party forms
  and are removed one minor after the UPGRADE_NOTES entry — keep `components/__tests__/formConfig.test.ts`
  alive while they are exported.
- **The list page has one create entry and one edit row action.** "Create Workflow" opens the
  template gallery (its *Blank* card is the empty canvas) and the `edit` row action points at the
  Studio; the old `edit-visual` duplicate is gone. Build every editor href with
  `buildVisualEditorHref` / `WORKFLOW_STUDIO_CREATE_HREF` (`lib/visual-editor-navigation.ts`) rather
  than a literal path, so the next move is a one-line change.

## Run Views & Recovery (spec §8.3 · §8.4)

- **`lib/run-execution.ts` (PURE) is the single answer to "what did this run do".** The instance
  detail page, the run Gantt and the Studio's "Show last run" overlay all derive from it, so they
  cannot disagree about which steps ran or which routes were taken. Two inputs, deliberately ranked:
  `StepInstance` rows are AUTHORITATIVE for step state (one row per execution, carrying the status,
  both timestamps, the measured duration and the attempt count), and `WorkflowEvent` rows are the
  fallback plus the ONLY source for the taken path — a transition leaves no row of its own. That
  ranking is a bug fix: the detail page reads the newest 100 events, so on a long run an early
  step's `STEP_ENTERED` has fallen off the page and an event-only derivation painted a completed
  step as never-run. `currentStepId`/`instanceStatus` travel ON the `RunExecution` so
  `resolveNodeRunStatus` can answer the START/END conventions without every caller remembering to
  pass them.
- **`StepInstance` finally has a read surface.** `GET api/instances/[id]/steps` (feature
  `workflows.instances.view`, page size capped at 100) serves the per-step input/output/error/
  duration/attempts the §8.3 inspector and the Gantt need. Before it, `inputData`, `outputData`,
  `executionTimeMs` and `retryCount` were written by the engine and read by nothing.
- **The run detail is Flow / Timeline / Context / Raw.** Selecting a node inspects it (spec §8.3)
  instead of navigating away; sub-workflow navigation moved INTO the inspector, which lists every
  child a step spawned. The failure banner stays ABOVE the tabs — it is the reason an operator
  opened the run, not one altitude of it.
- **The Gantt axis is PIECEWISE-LINEAR** (`lib/run-gantt.ts`, PURE). A run that executes for 1s and
  waits three days is 99.999% wait on a linear axis and shows nothing, so slices longer than a
  derived threshold (4× the median slice, floored at 1s) render at the threshold's width and are
  flagged. Time stays monotonic and every bar keeps its TRUE duration in `durationMs` — the
  compression is a rendering decision and MUST NOT reach a label. Lanes follow the engine's
  `branchInstanceId` so a parallel branch reads as one band.
- **Live run views** ride the DOM Event Bridge: the six `workflows.instance.*` lifecycle events
  carry `clientBroadcast: true`, and `components/run/useLiveRunUpdates.ts` REFETCHES rather than
  patching (the bridge is best-effort and caps a payload at 4KB), throttles the burst every step
  advance produces, and refreshes on `om:bridge:reconnected`. The broadcast payload is instance
  identity and state only — the bridge forwards it to every backoffice connection in the tenant +
  organization WITHOUT evaluating ACL features, which is why the task events stay off it.
  `workflows.instance.paused`/`resumed` are declared but have never had an emit site.
- **The failure queue is a UNION**, not a filter: attention-parked plus FAILED. The list route ANDs
  its `attention` and `status` filters and cannot express it, hence
  `GET api/instances/failure-queue`. Error grouping (`lib/failure-grouping.ts`, PURE) normalizes
  each message to its SHAPE — ids, numbers, quoted values and timestamps replaced by placeholders —
  and groups on that, keeping the first raw message as the label. Normalization is deliberately
  CONSERVATIVE: over-normalizing merges two genuinely different failures, and an operator who sees a
  merged group cannot tell that half of it will fail again on replay. Grouping runs in JS, so it is
  not a SQL `GROUP BY` — the response reports `scannedCount` and `truncated` instead of implying the
  groups cover everything.
- **Bulk replay goes through the progress module** (`lib/bulk-replay.ts` + a queue worker), per
  `progress/AGENTS.md`. The worker re-reads every instance under the caller's tenant + organization,
  so a foreign id resolves to nothing and is skipped rather than acted on, and one failing instance
  never aborts the batch — which is the point of a triage surface.
- **Rerun-from-step does NOT change the step state machine.** The previous attempt's terminal
  `StepInstance` is read for its recorded `stepType` and otherwise untouched; the replay's row is
  created by the engine's own `enterStep`, which already does an unconditional
  `em.create(StepInstance, { … status: 'ACTIVE' … })` on every entry. The cursor move plus
  `executeStep` is the same shape `enterErrorHandlerStep` uses. Four refusals, each a 409 with a
  code: a RUNNING instance (moving its cursor races the execution loop), a step the definition no
  longer declares, a step whose latest attempt is still PENDING/ACTIVE (a queue job and, for an
  agent step, a pending proposal are still addressed to THAT attempt — lifting this needs §7.4's
  addressable resume token), and a step whose type changed since the run (a FAILED instance is not
  "active", so the definition PUT guard permits an in-place structural edit).
- **Two new ACL features**, both admin/dev: `workflows.instances.rerun_step` (depends on
  `instances.retry` + `instances.update_context` — replaying with EDITED context is exactly those
  two powers together) and `workflows.instances.bulk_ops` (depends on `instances.retry` +
  `instances.cancel`). Existing tenants pick them up only after
  `yarn mercato auth sync-role-acls`.
- **The Studio overlay is render-time only.** "Show last run" decorates nodes and edges inside
  `WorkflowGraphImpl`, the same rule the compensation ghosts follow, so it never enters the
  document, the undo stack, an autosave or `graphToDefinition` — guarded by
  `lib/__tests__/last-run-overlay.test.ts`. It fetches nothing until the toggle is on.

## Per-Definition KPI Rollup (spec §8.5)

- **`lib/metrics/definition-metrics.ts` (PURE) owns what the numbers MEAN**;
  `lib/metrics/rollup-service.ts` owns the queries and the upsert. The shape MIRRORS
  `agent_orchestrator`'s `AgentMetricRollup` (tenant/org + logical id + window bounds +
  `computed_at` + a zod-validated `metrics` jsonb) and never imports it — `enterprise` is an
  optional peer. Two deliberate divergences fix latent flaws in the mirror: `window_key` is its
  own column and part of the key (otherwise a 7d and a 30d window can collide on `window_start`
  and overwrite each other), and the key `(tenant, org, workflow_id, window_key, window_start)` is
  DB-enforced UNIQUE (the mirror read-then-inserts with no constraint, so two passes both insert).
- **The rollup is RECOMPUTED, never incremented.** `writeRollupsForScope` snaps the bounds to
  `WORKFLOW_ROLLUP_BUCKET_MS` (15 min), rebuilds each window from source rows and upserts. Two
  passes in one bucket therefore produce byte-identical rows; a pass after the bucket rolls over
  adds a row rather than mutating history. MUST NOT convert this to an incremental counter.
- **Only metrics the engine actually populates ship.** `StepInstance.executionTimeMs` is
  deliberately NOT used: `exitStep` writes it on the COMPLETED path only, and every FAILED path
  leaves it null, so a "step p95" would be a success-only latency wearing the wrong name. Run
  duration is `startedAt` → the terminal timestamp instead. `successRate` counts the run's VERDICT
  (`outcome`), never its status: `partial_failure` and `compensated` are their own numbers.
  Mechanism: `apps/docs/docs/framework/workflows/run-outcomes.mdx`.
- **Every rate reports its denominator, and a zero denominator is `null`, never 0.** "No run
  finished in this window" and "every run failed" are opposite facts.
- **Dry runs never count**: `isDryRun: false` is on every instance query and tasks are reached only
  through those instances' ids. The same filter was missing from `api/instances/failure-queue` and
  is now there.
- **A rollup ROW is per-organization, so the read route serves it only for a single-organization
  scope**; a multi-org or tenant-wide scope live-computes over the resolved set, because counts sum
  across organizations but a percentile does not. `GET api/metrics/definitions` (feature
  `workflows.metrics.view`, batch capped at 50 ids) reports `source: 'rollup' | 'live'` per item and
  re-validates every stored row against `workflowDefinitionMetricsSchema`.
- Scheduled PER ORGANIZATION from `setup.ts` (`@open-mercato/scheduler`, optional peer, best-effort)
  onto the `workflow-definition-metric-rollup` queue. The queue name is a string LITERAL in the
  worker — the generator's AST extractor cannot resolve an imported one — and a test asserts it
  matches `WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE`.
- Still §8.5 and deliberately NOT here: repeated-failure alerts, the process correlation view,
  the triggers reverse lookup, a cross-org overview surface, retention/archival, and the
  stuck / awaiting-disposition-too-long halves of the needs-attention queue (the failed +
  attention-parked halves already ship as `api/instances/failure-queue`).

## Dry Run (spec §8.2)

- **A dry run is a REAL instance executed by the ordinary engine, not a second interpreter.**
  `WorkflowInstance.isDryRun` (additive boolean column) is written once at start and never mutated.
  A parallel simulator would drift from the engine and its report would stop being evidence about
  the workflow that actually runs.
- **`isDryRun` is a COLUMN, not a metadata key**, because every isolation decision reads it and a
  jsonb path predicate in a hot filter is both slower and easy to forget. `ExecutionContext.dryRun`
  in `lib/workflow-executor.ts` is `@deprecated` and inert: it never was read, and a per-call flag
  cannot survive an instance parking on a signal and resuming inside a worker — exactly when a leak
  would happen.
- **One swap point buys the whole guarantee.** `executeActivityByType` in `lib/activity-executor.ts`
  is the ONLY place `entry.execute` is reached, so a dry run swaps it for the registry `mock`
  there — and every effector (command bus, event bus, mailer, webhook fetch, agent bridge) is
  behind it. `mock: 'refuse'` or a missing mock throws `WorkflowDryRunRefusalError`.
- **A refusal is a STOP, never a failure.** Nothing was attempted, so it must not be absorbed by
  `continueOnActivityFailure`, an error route or an `errorDirective` — `transition-handler` answers
  `dryRunRefused` before any of those are consulted. It is also not retried.
- **A dry run never enqueues.** A queue job carries no `isDryRun` of its own, so a worker picking it
  up would run the real effector. `executeActivities` forces the sync path — and MUST also report
  `async: false` on the result, or the token parks in `WAITING_FOR_ACTIVITIES` waiting for a job
  that was never enqueued.
- **USER_TASK suppression is structural.** `handleUserTaskStep` skips the row, so there is no
  `workflows.task.assigned` event, therefore no notification row, no SLA reminder/breach jobs, and
  nothing for any Work Inbox or task-list query to return. Everything above the row still resolves,
  so the report names who the task WOULD have gone to. The step still WAITS.
- **`INVOKE_AGENT`'s mock names the agent and the disposition it would REQUEST** — never a
  fabricated outcome. A simulation has no model confidence, so it fails closed to `human_review`,
  the same rule `dispositionService` applies to a missing confidence. It carries `invoked: false`
  and a `kind` outside the runtime vocabulary so nothing mistakes it for a real disposition. No
  bridge call means no `AgentRun`, no proposal, and nothing reaching `dispositionService.dispose`.
- **Business-rule ACTIONS need their own flag.** The rule engine's `dryRun` only suppresses the
  execution LOG — `successActions`/`failureActions` run regardless — so the transition handler
  passes `skipActions` (additive, `packages/core/src/modules/business_rules`). Conditions still
  evaluate, so the run takes the routes it really would.
- **The "Would do" report is DERIVED from `WorkflowEvent` rows**, never stored twice, so it inherits
  the run views' scoping, ordering and retention. `lib/dry-run.ts` is PURE and owns both the event
  vocabulary (`DRY_RUN_EVENT_TYPES`) and `buildWouldDoReport`; `GET /api/workflows/instances/[id]/would-do`
  serves it and resolves each entry back to its definition `stepId`.
- **Dry runs are excluded from the instance list by default** (`?dryRun=true` opts in), and the
  agent KPI rollup floors proposal counts to the same runtime runs it already floors run counts to.
- Starting one needs `workflows.definitions.test_run` ON TOP of `workflows.instances.create` — it is
  the definition author's test loop, not a way to start instances.

## Step-Through & Start Fixtures (spec §8.1 · §8.2)

- **Step-through is an instance-level `PAUSED` between steps** (`lib/step-through.ts`, PURE) — the
  same shape the `failureQueue` directive uses. NO new instance status and NO new step status, so
  the state machines are untouched. Independent of dry run: a real run can be stepped through, and a
  dry run can be let loose end to end.
- **The marker is a RELEASE TOKEN, not a paused boolean.** The author releases ONE named step, the
  engine burns the token before running it, and the cursor landing anywhere else pauses again. That
  is what makes it idempotent: replaying `executeWorkflow` after a crash cannot run a step nobody
  released, and a double Continue cannot run two steps.
- **`POST api/instances/[id]/step-through`** (`continue` | `stop`, feature
  `workflows.definitions.test_run`) mints the token from the instance's OWN `currentStepId` — never
  from the request body — so a client cannot release a step the run is not sitting on. Aborting is
  the existing cancel endpoint; a second way to cancel would be a second place to get compensation
  wrong. The marker is engine-owned: only the feature-gated start flag and this route write it.
- **END is exempt from the pause**, so a finished step-through reads COMPLETED rather than parked one
  click short of the end.
- **Start fixtures are named START contexts** (`lib/start-fixtures.ts`, PURE,
  `metadata.editor.fixtures`) and are a DIFFERENT thing from pinned per-step samples — the spec says
  so, and conflating them would make "which wins" unanswerable. Caps are checked against the RESULT,
  so shrinking your way back under a cap always works. Fixture data is stored verbatim and is neither
  redacted nor encrypted; keep the warning copy wherever one is saved.

## Code View (stage 2 — two-way sync)

- **The safety model, and why it is asymmetric.** Spec §2.2 asks for "two-way live sync"; taken
  literally — mutate the canvas on every keystroke — it is unimplementable safely, because deleting
  the `s` of `"steps"` momentarily produces a document with no steps and applying it would delete
  every node, lose the arrangement and push one undo entry per character. So each direction gets what
  it can actually support: **canvas → code is LIVE** (the panel re-renders from the canvas whenever
  the author has not started editing); **code → canvas needs an explicit Apply** (button or
  Cmd/Ctrl+Enter). Parsing, validation, the issue list and the gutter markers stay LIVE as you type,
  so the feedback loop is immediate even though the commit is not.
- **`lib/code-view-apply.ts` (PURE) is the gate**, which is what makes the rule testable without a
  canvas. Four escalating refusals, each with its own reason: `unchanged` · `parseError` (carrying
  the line to mark) · `schemaError` · `graphError`. Graph WARNINGS never block, exactly as they never
  block a Save; graph ERRORS do, because a canvas holding a graph the engine would reject is worse
  than no apply — the author has lost the text they typed and now repairs a canvas by hand.
  Validation runs `definitionToGraph(..., { autoLayout: false })`: whether a definition is valid
  cannot depend on running a layout engine over it.
- **An apply is ONE fully reversible action.** `WorkflowEditorDocument` gained an optional `panel`
  carrying the definition-panel fields the canvas does not hold (triggers, `contextSchema`, `io`,
  `interpolation`, `errorHandler`), because the Code view's Apply replaces the WHOLE definition —
  undoing it without them would restore the graph with somebody else's triggers attached. Entries
  captured before the field existed carry none, and readers then leave the panel alone.
- **Markers are GUTTER markers, not underlines.** A plain textarea cannot decorate a substring, and
  an overlaid highlight layer drifts out of alignment with the textarea's own text metrics. Each
  marked line carries its severity glyph as well as its DS colour, per the §4.6 colour-only rule, and
  every issue row states its line and focuses it.
- **`lib/definition-json-locations.ts` (PURE) answers WHERE a node lives** in the JSON text, with a
  minimal tokenizer rather than a regex over `"id": "<value>"` — the author is editing free text, so
  a step id also appears inside `{{context.*}}` templates, inside `fromStepId`, and inside note
  markdown, and a regex would happily point the squiggle at any of them. Ids are attached from the
  PARSED document by array index, so a malformed id cannot desynchronise the scan.
- **Closing the panel discards an unapplied draft.** Keeping it would let the author reopen the view
  onto text that no longer describes the canvas, with no signal that the two had diverged.
- **The JSON is the save payload, not a re-serialization.** It is assembled through the same
  `graphToDefinition` + `buildDefinitionPayload` pair `handleSave` uses, so what an author reads is
  byte-for-byte what a Save would persist, and what they apply is the same shape. It is only computed
  while the drawer is open.
- **Paste reuses the canvas clipboard format** (`lib/subgraph-clipboard.ts`) through the page's own
  `handlePaste`, so a fragment copied from the canvas and a fragment copied out of the Code view are
  the same payload, an unknown payload is refused with the same message, and the paste is ONE undo
  entry. The Copy button copies the WHOLE definition JSON — the document, not a fragment.
- **The issue list is the Problems panel's list.** Both call the page's `evaluateWorkflowIssues`
  (graph errors + `workflowDefinitionDataSchema` + activity-config and context-ref warnings through
  `collectValidationIssues`), so the two surfaces can never disagree about what is wrong. Severity
  pairs its DS token with an icon AND an `sr-only` name, per the §4.6 colour-only rule.
- The view is reachable from the toolbar and from the Cmd+K palette (`view.toggleCodeView`); while it
  is open the canvas keyboard bindings are suppressed exactly as they are for a dialog.

## Editor Annotations (sticky notes · groups)

- **Annotations are documentation and NEVER execution semantics.** `lib/editor-annotations.ts`
  (PURE) owns them; they live in `metadata.editor.annotations`
  (`{ notes: [{id, markdown, position, size}], groups: [{id, name, rect, collapsed?}] }`) and nowhere
  else. `graphToDefinition` filters their nodes out of `steps` AND drops any edge that touches one,
  so a definition carrying a hundred notes serializes byte-identically to one carrying none — a test
  asserts exactly that. `validateWorkflowGraph`, `applyAutoLayout` and the subgraph clipboard skip
  them for the same reason: a note has no routes, no rank and no definition form.
- **They are still React Flow NODES while the editor is open.** That is what makes a note drag, undo,
  select and autosave exactly like a step without a second code path. The node array is the single
  source of truth; `annotationsFromNodes` derives the persisted shape on every save, draft and quiet
  autosave, and `buildMetadataPayload` writes it back. Omitting its `annotations` argument leaves
  whatever the loaded metadata carried untouched, which keeps non-canvas callers byte-compatible.
- **A group stores a RECT, not a member-id list.** A region needs no maintenance when a step it
  overlaps is deleted, pasted or converted, and an id list would be a second source of truth the
  engine must never read anyway.
- **Collapse is visual only** — the body fades and the region shrinks to its header; no step moves and
  no route changes, because a graph-mutating collapse would be execution semantics.
- Notes and groups are resizable (`NodeResizer`), and a resize persists like a drag: `WorkflowGraphImpl`
  reports `resizing: true` frames as `persistable: false` and only the resizer's final frame
  (`resizing === false`) commits, so one gesture is one autosave and one undo entry. React Flow's own
  measurement changes carry no `resizing` flag and stay non-persistable as before.

## Keyboard Path & Accessibility (acceptance criterion)

Spec §4.6 makes this an EXPLICIT acceptance criterion, not a polish item: *"Every canvas operation is
reachable without a pointer… ARIA labeling on nodes/routes/badges… Status is never color-only."*
Treat a regression here as a broken feature, not a nit.

- **The Cmd/Ctrl+K command palette is the complete non-pointer path.** `lib/editor-commands.ts`
  (PURE) builds the descriptors — undo/redo, delete, copy/paste/duplicate, add any step type, add a
  note or group, go to any step, Tidy, every panel toggle, Validate, Start instance, Save — and
  `components/WorkflowCommandPalette.tsx` renders them through the platform's `CommandMenu`
  primitive (`@open-mercato/ui/primitives/command-menu`, `cmdk` + Radix dialog) rather than a second
  palette implementation. A command that cannot run right now is DISABLED with its shortcut shown,
  never hidden: a missing entry reads as "unsupported", a disabled one as "not now". Because the
  descriptors are pure data, dispatch is unit-tested without a dialog or a canvas.
- **Direct bindings** cover what an author does constantly: `Enter` opens the inspector for the
  selection (step or route), `Del`/`Backspace` deletes it through the same confirm + cleanup flow the
  trash button uses, the arrows nudge it (`Shift` for a coarse step). Nudging follows the drag rule
  (#4248) — a BURST of keystrokes is one arrangement, so `lib/node-nudge.ts` (PURE) moves the nodes
  and the page commits one undo entry plus one autosave once the burst settles.
- **Guards.** Every binding except Cmd+K is suppressed while a field has focus or a dialog is open, so
  it never hijacks form input, native copy/paste, the caret keys or a dialog's Escape. Cmd+K is
  deliberately EXEMPT from the typing guard — it is the way out of any focus, which is the point of a
  palette. Every dialog keeps `Cmd/Ctrl+Enter` to submit and `Escape` to cancel.
- **Status is never colour-only.** Each node status pairs its DS token colour with its own icon shape
  AND an `sr-only` name; the card carries `role="group"` with a `{type}: {title} — {status}` label and
  a `data-node-status` hook. Error routes pair red + dashes + a warning icon, completed route labels
  pair green + a check, route chips are labelled buttons and the collapsed semantic-zoom dot row is a
  labelled `role="img"`. `components/__tests__/canvasAccessibility.test.tsx` is the guard.

## Step & Route Inspector (the docked rail)

- **`components/InspectorPanel.tsx` is the ONE shell** both inspectors render
  through (`NodeEditDialogCrudForm`, `EdgeEditDialogCrudForm`). They used to be two
  independent modals that had drifted apart in padding, heading shape and close
  affordance. MUST NOT give either its own chrome again.
- **`docked` is a layout sibling of the canvas, not an overlay.** The page renders
  it INSIDE the editor row (`data-testid="workflow-editor-row"`), so opening it
  narrows the graph and leaves it visible and clickable. `overlay` is the same
  content in a modal `Drawer` and is what the compact (<1280px) layout uses — that
  layout is a separate single-column branch with no row to dock into.
  `inspectorsDocked` in the page owns the decision; both variants are otherwise
  identical, or a step inspected on a laptop stops being the same surface.
- **Docking is SPATIAL, never a keyboard change.** An open inspector still owns the
  shortcuts: it holds unsaved form values, and every canvas binding either mutates
  the document under it (undo, delete, paste) or would save a graph that omits the
  edit sitting in the rail. Escape from the canvas closes the rail; Escape raised
  inside it is claimed by the panel itself (`stopPropagation`).
- **Exactly one rail at a time.** With a live canvas a step click can arrive while
  the ROUTE inspector is open, so `handleNodeClick` / `handleEdgeClick` each close
  the other. The modal variant could never reach that state.
- **The form is KEYED on the inspected record.** `CrudForm` deliberately preserves
  fields the author already edited when `initialValues` changes — right for
  late-arriving field definitions, wrong for re-targeting, where it would carry an
  unsaved edit from step A onto step B and save it there. MUST keep `key={node.id}`
  / `key={edge.id}`.
- **The ledger panel folds by default here** (`InputDataPanel defaultCollapsed`).
  In the old 1280px modal it sat BESIDE the form and cost nothing; stacked under
  the form in a 384px column an expanded ledger pushes the form off the top.
- **Both inspectors pass `density="compact"` to `CrudForm`** (the prop added for
  this rail). `CrudForm`'s default lays groups out for a full-width page, which is
  airy at 384px; compact steps the between-group and between-field spacing and the
  group-card padding one DS step down and changes NOTHING else. MUST NOT reach for
  descendant `[&_…]` overrides on a shared primitive from this module instead — if
  a narrow host needs more, extend the prop where it lives.

## Definition Metadata Drawer

- **`components/DefinitionMetadataDrawer.tsx` is the ONE definition-metadata form.** The Studio and
  the mobile editor both render it; `components/mobile/MobileMetadataSheet.tsx` is `@deprecated` with
  no call site left. It was a second copy of the same form that never gained `contextSchema`, the
  interpolation mode or the error handler, so mobile authors could not edit them at all — MUST NOT
  reintroduce a per-viewport copy.
- **It is a Drawer because the canvas is what the page is for.** The form used to render inline above
  the canvas in a `max-h-[45svh]` band (`60svh` compact), i.e. it was designed to eat up to half the
  viewport on the one page whose purpose is the graph, and everything past the second row of fields
  was reachable only by scrolling inside the band. The drawer takes 4/5 of the width (sanctioned) and
  costs the canvas nothing.
- **Five sections, not tabs.** `Identity` (workflow id + version + name + description — the id and
  version ARE the unique key the engine resolves an instance against, which is why both lock after
  creation), `Presentation` (icon/category/tags), `Availability` (enabled + effective window),
  `Inputs and triggers` (`contextSchema` + triggers), `Runtime behaviour` (interpolation +
  `errorHandler`). Tabs would hide a blank required field behind a navigation step, split the Tab
  order and break Ctrl+F, on a form filled top-to-bottom before the first save.
- **It starts CLOSED and is never auto-opened on load.** It is a modal overlay: opening it on mount
  would leave the author unable to touch the canvas until they dismiss it. `handleSave` opens it when
  the required id/name are blank, and the toolbar trigger carries a marker (icon + `sr-only` text,
  never colour alone) meanwhile.
- **Canvas key bindings are suppressed behind it** (`isOverlayOpen` in the page's keydown handler).
  Cmd+S is the deliberate exception — the drawer has no submit of its own to protect, saving the
  workflow IS its primary action. Cmd/Ctrl+Enter saves, Escape closes.
- The round trip is guarded by `backend/definitions/visual-editor/__tests__/metadataDrawer.test.tsx`:
  open → edit every field → save, asserting each edited value reaches the PUT body AND that every
  pass-through key (`contextSchema`, `io`, `interpolation`, `errorHandler`, unknown metadata keys)
  survives. Fields silently dropped on save are this module's recurring bug class.

## Definition Icon Picker

- `components/WorkflowIconPicker.tsx` replaces the free-text `metadata.icon` input with a searchable
  grid over the platform's SHARED registry (`LUCIDE_ICON_REGISTRY` from
  `@open-mercato/ui/backend/icons/lucideRegistry`). That registry is generated from the icon names
  actually used across the repo and `AppShell` already loads it on every backend page, so the grid
  adds NOTHING to the editor chunk — importing `lucide-react` wholesale for a field that stores one
  string is the bundle regression this deliberately avoids (#3169).
- **Free text stays the fallback.** `metadata.icon` has always been an open string, so the picker
  keeps an input: a name the registry does not know is stored verbatim with a warning, never dropped.
  `normalizeIconName` (`lib/icon-search.ts`, PURE) maps every historic spelling — `ShoppingCart`,
  `shopping_cart`, `lucide:shopping-cart` — onto the registry key, which is what makes an existing
  definition open with its icon already selected. Selecting from the grid writes the kebab-case key.

## Palette Drops (drag-from-palette · insert-on-route)

- **Click stays the keyboard path.** Every palette entry is a `<button>` that appends on click; drag
  is an ENHANCEMENT layered on top (`draggable` + `lib/palette-drag.ts`, which writes a readable
  `text/plain` label plus the private `application/x-om-workflow-palette` payload, mirroring
  `lib/ledger-drag.ts`). Never make an entry drag-only.
- **The graph resolves the target, the page performs the effect.** `WorkflowGraphImpl` owns the two
  things only React Flow and the DOM can answer — the flow-space cursor position
  (`screenToFlowPosition`) and which route the cursor is over (`document.elementsFromPoint` →
  `.react-flow__edge[data-id]`, exact where geometry over a smooth-step curve would only approximate)
  — and hands the page a plain `WorkflowGraphDropEvent`. The effects live in the PURE
  `lib/palette-drop.ts`, so the xyflow boundary (#3169) is unaffected.
- **Three drop outcomes**: a step on empty canvas is placed at the cursor via `lib/node-placement.ts`;
  a step on a route is spliced between that route's endpoints; an action on a route is appended to
  that route's activities (the #4244 chips then render it). An action needs a route — dropping one on
  empty canvas says so instead of doing nothing. Each drop is ONE undo entry.
- **Insert-on-route keeps the original route's data on the FIRST segment** (`from → new step`): a
  condition guards LEAVING its source step and the activities run on the way out, so both belong to
  the segment that still starts where the author put them, an error route stays the error path out of
  that step, and the durable `transitionId` — which `instance.pendingTransition` and
  `WorkflowBranchInstance.branchKey` resolve against — stays attached to it. The second segment
  (`new step → to`) is a fresh unconditional auto route.

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
6. Optional: `mock` — `((config, ctx) => unknown) | 'refuse'` — powers the mock-first Test step (`'refuse'` and missing mocks return structured refusals; side-effecting types return would-do payloads like `{ sent: false, simulated: true }`), and `outputContract` for the context ledger (UPDATE_ENTITY resolves it via `commandRegistry.outputSchemaOf(commandId)` **nested under `executeUpdateEntity`'s envelope** — `{ executed, commandId, logEntryId, result }` — degrading to `'unknown'` when the command declares none).
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

### Trigger Sources And Precedence

`loadTriggersForTenant()` (`lib/event-trigger-service.ts`) merges three sources into `UnifiedTrigger`s, each tagged with a `source` discriminator:

| `source` | Origin | Notes |
|----------|--------|-------|
| `legacy` | `workflow_event_triggers` rows | Backward compatibility with triggers created before triggers were embedded in definitions |
| `embedded` | `triggers[]` inside a `workflow_definitions` row's `definition` JSONB | What the visual editor and the definitions API write |
| `code` | `triggers[]` on a code-defined workflow in the in-memory registry (`defineWorkflow`) | Projected by `loadCodeTriggers()`; no DB row required (#4425) |

Precedence: **a DB-backed definition wins over its code counterpart.** Any non-deleted `workflow_definitions` row shadows the code projection for the same `workflowId` — including a disabled row, and including a customization whose `triggers[]` was emptied. This preserves `customize` semantics: once an operator materializes a code workflow, the DB row alone decides which triggers are live.

MUST invalidate the trigger cache after any write that changes which source owns a workflow's triggers — `loadTriggersForTenant()` caches per tenant/organization for `TRIGGER_CACHE_TTL` (5 min), so without invalidation the wildcard subscriber keeps matching a stale snapshot:

```typescript
import { invalidateTriggerCache } from '../lib/event-trigger-service'

if (tenantId) invalidateTriggerCache(tenantId, organizationId ?? undefined)
```

This covers definition create/update/delete **and** `POST .../[id]/customize` (code projection → embedded row) and `POST .../[id]/reset-to-code` (embedded row → code projection). Invalidate for the **written row's own** tenant/organization rather than the caller's — `customize` looks an override up by `(workflowId, tenantId)`, so it can revive a row owned by a sibling organization. Omitting `organizationId` clears every organization under the tenant.

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
├── acl.ts                    # 27 RBAC features
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
