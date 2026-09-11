# Phase 5 — Agent contract & debugging depth: implementation briefing

Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7, §8 + roadmap line 452–454.
Convergence input: `.ai/analysis/2026-07-28-canvas-visual-fidelity.md` gap #4.
Baseline: `feat/agent-orchestrator-mvp` @ `9cf3faf13` (Phases 0–4a + canvas fidelity + §6.4 shipped).
Paths below are relative to `packages/core/src/modules/workflows/` unless prefixed.

---

## 0. Convergence verdict — outcome routes vs. the node footer (gap #4)

**They are the same thing for the agent node, with one enumeration mismatch that must be settled before coding.**

Gap #4 says the footer needs three things in order: (1) enumerate outcomes, (2) named source handle ids + transition binding by handle, (3) render the rows. §7.2 delivers (2) verbatim — *"exposes labeled output handles routed **declaratively** by the step handler on the disposition result … handles compile to transitions carrying a new optional `outcomeKind`"* — and §4.4 already lists *"**outcome routes** on agent nodes (§7.2)"* beside error routes and SLA-breach routes. So the footer is the *render* of the handle set §7.2 creates; it is not a lookalike.

**The mismatch.** Gap #4 step 1 proposes enumerating outcomes from *"the agent's OUTCOME schema (the `recommendation` enum in the mockup's contract)"*. §7.2 enumerates a **fixed platform vocabulary of disposition kinds**: `approved` (auto_approved), `informative`, `rejected`, `guardrail blocked`, `error`. These are different sets — one is domain data, one is governance state. **Build the footer against §7.2's five kinds.** An OUTCOME-enum-derived footer is an unspecced second feature (it would need a per-value condition on the transition, i.e. the very context string-matching §7.2 exists to kill). Say so in the PR description so the fidelity analysis is not read as authorising it.

**The user-task half of gap #4 is cheaper than the analysis assumed and does not depend on §7.2.** Phase 4a already ships `taskDecisionSchema` (`data/validators.ts:216-221`) with a durable `transitionId` per decision, and `lib/task-decisions.ts:58-70` resolves decision → outgoing transition. Every footer row a user-task node needs (`call done` / `unreachable`) already exists as data; only the *handle* is missing. Render it from `userTaskConfig.decisions` with zero engine change.

**Third finding: `slaBreach` is a half-landed precedent, and Phase 5 must finish it.** `SLA_BREACH_TRANSITION_KIND`/`SLA_BREACH_SOURCE_HANDLE_ID` exist (`lib/breach-routing.ts:26,33`) and the engine honours them, but **zero consumers** — no canvas handle, and `graphToDefinition` (`lib/graph-utils.ts:234`) only special-cases `'error'`, so **opening and saving a `kind:'slaBreach'` definition through the Studio silently downgrades it to `normal`**. That is a live data-loss bug on the exact mechanism outcome routes copy. Generalise the handle→kind round-trip once and retrofit `slaBreach` in the same PR.

### The other deferred fidelity items

| Item | Size | Verdict |
|---|---|---|
| **Gap 6 — node information density** (config summary line, drop the type-label row) | M | **Fold into this run's PR A.** The analysis is explicit: every node-geometry change must land as one batch and re-run the dagre footprint once (`analysis:425`). Outcome footers make agent nodes ~50px taller; gap 6 returns ~26px. Doing them separately means two `estimateNodeSize` reworks (`lib/graph-utils.ts:558-576`) and two 60-node density re-measurements. Also deduplicate `NODE_MIN_WIDTH`/`NODE_MAX_WIDTH` (`components/WorkflowNodeCard.tsx:10-11`) against `NODE_WIDTH`/`NODE_HEIGHT` (`lib/graph-utils.ts:22-24`) **before** either change, per `analysis:425`. |
| **Gap 5 — trigger as a canvas node** | M | **Own PR, sequenced after PR A.** No engine dependency (`analysis:432`: "the data exists"), so it is not Phase 5 scope. But it edits `applyAutoLayout`'s node set in `lib/graph-utils.ts:612-645` — the same file PR A rewrites — so run it after, not in parallel. |
| **Gap 7(b) — inspector rail** | L | **Not this run.** §7.5 (Review Who/When) and §7.6 (threshold slider, model/budget tags) add fields to `NodeEditDialogCrudForm.tsx` — converting the host from `Dialog` to a 380px rail while the field set is still moving compounds risk, and the re-host must preserve `CrudForm`'s optimistic-lock/409 path (`analysis:368`). Do it *after* PR B, against the final field set. Ship gap 7(a) (tighten spacing, overline section headers) opportunistically inside PR B since it touches the same file. |

---

## §7 — Agent contract (agent-specific; separable from §8)

### 7.1 / 7.2 — Outcome routes + progressive disclosure

**(a) Requirements (verbatim)**
> "The Invoke Agent node exposes labeled output handles routed **declaratively** by the step handler on the disposition result (no more context string-matching): `approved` (auto_approved), `informative`, `rejected`, `guardrail blocked`, `error`. Compilation is additive: handles compile to transitions carrying a new optional `outcomeKind`; old condition-based definitions keep working." (§7.2)
> "**Progressive handle disclosure (fan-explosion defense):** the node renders only wired handles plus `approved` and a "+ outcome" affordance; unwired outcomes inherit the node's error directive, and the node face states that inheritance ("unhandled → fail instance")." (§7.2)
> "**Rejection is a business route, not an error:** agent *failure* (infra) retries per policy then routes `error`; a *rejected proposal* routes `rejected`. The worker's current conflation is split." (§7.2)
> "**No parallel continuation in v1.** The draft's `needs review` edge … is **cut**." (§7.2)

**(b) Code anchors**
- Pattern to copy, in this order: `lib/error-routing.ts` (237 ln — the canonical shape: `*_TRANSITION_KIND`, `*_SOURCE_HANDLE_ID`, `is*Transition`, `exclude*Transitions`, `find*Transition`, one `resolve*Handling` decision point, `validate*Routes`) then `lib/breach-routing.ts` (143 ln — the shorter sibling, and the one whose gaps show what not to skip).
- Enum: `data/validators.ts:543` — `export const transitionKindSchema = z.enum(['normal', 'error', 'slaBreach'])`; used at `:678` inside `workflowTransitionSchema` (`:661-680`).
- Engine exclude-filters that MUST learn the new kind or it gets auto-selected as a happy path: `lib/transition-handler.ts:200`, `:286-291` (`findValidTransitions`); `lib/workflow-executor.ts:446-447`; `lib/task-decisions.ts:64`; `lib/route-priority.ts:66` (`outgoingNormalRoutes` — currently misses `slaBreach`).
- Compiler round-trip: `lib/graph-utils.ts:234` (edge→transition, `graphToDefinition`), `:275` (activity-inheritance guard), `:506`/`:512-517` (transition→edge, `definitionToGraph`).
- Reattachment: `lib/edge-reattachment.ts:28` (`ERROR_ROUTE_SOURCE_NODE_TYPES`), `:58-61`, `:114-119`.
- Canvas connect: `backend/definitions/visual-editor/page.tsx:1351-1369` (`handleConnect`, `isErrorRoute` branch).
- Handle component to clone: `components/nodes/ErrorOutputHandle.tsx` (32 ln, `style={{ top: '75%' }}`); mounted in `nodes/{UserTask,Automated,SubWorkflow,InvokeAgent}Node.tsx`.
- Port-table precedent for footer rows: `components/nodes/SubWorkflowNode.tsx:102-147` (per-port handles positioned inline) — `analysis:225` calls this "the right thing to generalise".
- Edge render: `components/WorkflowTransitionEdge.tsx:26-33,45,56,72-76`; colours `lib/status-colors.ts:79` (`EdgeState`), `:99-123` (`EDGE_COLORS`).
- Where the disposition kind arrives today: `lib/step-handler.ts:604-638` (inline branch writes `disposition`/`agentProposalId` into `instance.context` — the string-matching §7.2 replaces) and `lib/activity-worker-handler.ts:427-475` (parked-resume path, `sendSignal` payload). Envelope kinds: `lib/agent-result-mapping.ts:17` — `'auto_approved' | 'informative' | 'user_task'`.
- Footprint estimator: `lib/graph-utils.ts:558-576` (`estimateNodeSize`, flat 84/108 today).

**(c) Approach**
1. Deduplicate node-dimension constants (`WorkflowNodeCard.tsx:10-11` ↔ `graph-utils.ts:22-24`) into one exported source. No behaviour change.
2. New pure `lib/outcome-routing.ts` mirroring `error-routing.ts`: `OUTCOME_TRANSITION_KIND = 'outcome'`, per-outcome handle ids (`outcome:approved` … `outcome:guardrailBlocked`), `AgentOutcomeKind` union, `excludeOutcomeTransitions`, `findOutcomeTransition(definition, stepId, outcome)`, and `resolveAgentOutcomeHandling(definition, stepId, outcome)` with precedence **wired outcome route → step `errorDirective` (the "unwired inherits" rule) → `fail`**.
3. Extend `transitionKindSchema` to `['normal','error','slaBreach','outcome']` and add `outcomeKind: z.string().optional()` to `workflowTransitionSchema`. Bump `minEngineVersion` on definitions that use it (`data/entities.ts:198` `WorkflowMetadata.minEngineVersion`) so older engines refuse rather than misexecute.
4. Wire the four exclude-filters + `route-priority.ts:66`; **retrofit `slaBreach` into the same generalised handle→kind round-trip in `graph-utils.ts` and `edge-reattachment.ts`** (fixes the silent downgrade).
5. Split rejection from error: `lib/activity-worker-handler.ts` currently resumes every disposition through one signal payload. Route `disposition === 'rejected'` → `outcome:rejected`; infra failure keeps the existing retry policy then `kind:'error'`.
6. Footer UI on `InvokeAgentNode` + `UserTaskNode`: rows = wired outcomes + `approved` + `+ outcome`; DS substitutions per `analysis:242-252` (`text-overline`/`text-xs`, `px-2 py-1`, `gap-0.5`, `size-2.5`, `bg-status-*-icon`, `border-t border-border`). **Give each outcome a distinct glyph** (check / info / slash / shield) — `analysis:441` forbids hollow-vs-filled red as the only discriminator, and the collapsed-dot zoom (`ROUTE_CHIP_ZOOM_THRESHOLD = 0.6`) must not inherit colour-only semantics.
7. Make `estimateNodeSize` outcome-count-aware; land gap 6's config-summary line in the same batch; re-run the 60-node density check once.

**(d) Test surface** — new `lib/__tests__/outcome-routing.test.ts` (mirror `error-routing.test.ts` + `breach-routing.test.ts`). Extend: `graph-utils-branching.test.ts`, `graph-utils.appendWorkflowEdge.test.ts`, `edge-reattachment.test.ts`, `route-priority.test.ts`, `transition-handler.test.ts`, `step-handler.test.ts`, `branching-routes.test.ts`, `definition-edit-safety.test.ts`, `nodeGeometry.test.ts`, `graph-layout-positions.test.ts`, `status-colors-ds.test.ts`; components `errorRouteRendering.test.tsx`, `WorkflowNodeCard.test.tsx`, `canvasAccessibility.test.tsx`, `routeChips.test.tsx`. **Add a round-trip regression asserting `slaBreach` survives `definitionToGraph → graphToDefinition`** — the gap that lets it silently downgrade today. Integration: `TC-WF-051` outcome-route dispatch per disposition kind (spec's required path: *"outcome-route dispatch per disposition kind incl. guardrail block"*).

### 7.3 — Guardrail escalation

**(a)** > "A guardrail `block` routes the `guardrail blocked` handle (typical wiring: → review task with the guardrail evidence bound); unwired, it follows the error directive. `agent_orchestrator.guardrail.tripped` finally gets a governed landing path."

**(b)** Emit: `packages/enterprise/.../lib/guardrails/guardrailService.ts:278`; also `lib/runtime/nativeAgentRunner.ts:157,425`. Entities `AgentGuardrailCheck` (`data/entities.ts:749-795`, kinds at `:727-734`, results `pass|warn|block` at `:735`). Current only consumer is a Caseload live-refresh (`backend/caseload/page.tsx:375`). Bridge return path: `AgentWorkflowBridge` (`lib/runtime/invokeAgentForWorkflow.ts:59-70`).

**(c)** The bridge outcome must carry a `guardrailBlocked` discriminator; today a block fails the runner and surfaces as an infra error, so the workflow can only see it as `kind:'error'`. Extend `InvokeAgentForWorkflowOutcome` additively (optional field ⇒ absent means current behaviour), map it to `outcome:guardrailBlocked` in the worker/step handler. **Evidence binding must respect** `agent_orchestrator/AGENTS.md:84`: *"evidence MUST be redacted (never raw PII)"* — bind the `AgentGuardrailCheck` id, not the evidence blob.

**(d)** `lib/__tests__/invoke-agent-*.test.ts` extensions; integration `TC-WF-052` (guardrail block → routed handle → review task raised).

### 7.4 — Explicit park/resume  ⚠️ Ask-First

**(a)** > "Replace the emergent dance (1s enqueue delay, "not parked yet, retrying", relaxed signal matching) with an engine primitive: `parkStep(stepInstanceId, { resumeToken, timeout? })` / `resumeStep(resumeToken, outcome, payload)` … Externally the `agent_orchestrator.proposal.ready` signal is dual-listened for ≥1 minor. This refactor gates disposition SLAs and rerun-from-step."

**(b)** The dance, exactly:
- `lib/activity-executor.ts:129` `INVOKE_AGENT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'`; `:145` `INVOKE_AGENT_ENQUEUE_DELAY_MS = 1000` consumed at `:1330`; `:1313-1337` returns the `__park` marker; `:153-163` `ActivityParkMarker`.
- `lib/step-handler.ts:567-601` — detects `__park`, logs `SIGNAL_AWAITING`, sets `PAUSED`, returns `{ status: 'WAITING', waitReason: 'SIGNAL' }`.
- `lib/activity-worker-handler.ts:348-371` — the retry loop, including `throw new Error('invoke_agent: instance … not parked yet (status=…); retrying')`.
- `lib/signal-handler.ts:203-250` — relaxed matching: `isInvokeAgentStep` (`:214-217`), widened `stepCanReceiveSignal` (`:222-227`), fallback `expectedSignalName` (`:237-243`).
- Human resume: `packages/enterprise/.../lib/disposition/resume.ts:37-78`, called from `commands/dispose.ts:246`.

**(c)** `parkStep`/`resumeStep` on the executor addressing `StepInstance.id` (branch-safe by construction — `StepInstance.branchInstanceId` exists, `data/entities.ts:567-624`). Keep the signal path dual-listened: `resumeStep` becomes the primitive, `sendSignal('agent_orchestrator.proposal.ready')` a thin adapter over it for ≥1 minor. Delete the 1s delay and the retry-throw only once `parkStep` commits before enqueue. The resume token belongs in `StepInstance` (additive column) or `WorkflowInstance.metadata` — the token must address the *step instance*, not the definition path.

**(d)** `lib/__tests__/executor-pause-on-park.test.ts`, `invoke-agent-async.test.ts`, `invoke-agent-queue-split.test.ts`, `invoke-agent-retryable.test.ts`, `signals.test.ts`, `parallel-handler.test.ts`. Integration `TC-WF-053` park/resume primitive (dispose → resume), plus a dual-listen regression proving the raw signal still resumes.

### 7.5 — Disposition Review (Who/When) + SLAs  ⚠️ Ask-First (hard)

**(a)** > "**The Review section (Who/When) lives on the Invoke Agent inspector** … Today `dispositionService` hard-codes an unassigned task; that becomes configuration authored on the node. Defaults: the agent's operator role, no deadline."
> "The disposition task is a real Work Inbox task and inherits deadline/breach-edge mechanics — "nobody disposed in 2 days → escalate/auto-reject" is the SLA-breach route on the agent node."
> "The run view shows a parked agent step as **"awaiting disposition since X · assigned to Y · open task ↗"** — distinct from generic PAUSED."
> "`agent_orchestrator.delegation_grant.revoked` resolves affected parked steps to their `error` route (or cancels, per node config)."

**(b)** `packages/enterprise/.../lib/disposition/dispositionService.ts:109-156` — `raiseUserTask`/`createUserTask`, the hard-coded row at `:135-144` (no `assignedTo`/`assignedToRoles` ever set). Reuse-targets on the core side: `taskAssignmentConfig` fields in `userTaskConfigSchema` (`data/validators.ts:236+`), deadline/breach at `:307` (`onBreach`), `lib/task-sla.ts:303-399` (`applyBreachHandling`) and `:409-463` (`resumeAfterBreachRoute`). Inspector host: `components/NodeEditDialogCrudForm.tsx` (task Who/When groups at `:419`, `TaskOnBreachField` at `:753-756` / `components/fields/TaskDeadlineFields.tsx:91-172`) — the §6.1.3/§6.1.4 tabs the spec says to reuse. Revocation event declared `packages/enterprise/.../events.ts:41`, emitted `commands/grants.ts:127-137`, **zero subscribers today**.

**(c)** Author the assignment/deadline on the `INVOKE_AGENT` node config, pass it through `AgentWorkflowBridge.invokeAgentForWorkflow` args (additive optional field), and have `createUserTask` consume it. The SLA route reuses `slaBreach` — which is exactly why §7.2's PR must first make `slaBreach` round-trip through the canvas. Add the first subscriber for `delegation_grant.revoked` (a `subscribers/*.ts` in agent_orchestrator resolving parked steps to their `error` route).

**(d)** `lib/__tests__/task-sla.test.ts`, `task-inspector-config.test.ts`, `work-inbox-provider.test.ts`; enterprise disposition tests. Integration `TC-WF-054` (deadline on a disposition task escalates via the agent node's breach route), `TC-WF-055` (revoked grant resolves the parked step).

### 7.6 / 7.7 — Threshold slider, draft cards, trace links, evals hook

**(a)** > "Node face/inspector show: model/runtime tag, maxSteps/budget when configured, the auto-approve **threshold slider** with fail-closed semantics spelled out ("no confidence ⇒ human review"). In the run view a pending proposal renders as a **draft card** (Lindy pattern) with the would-be mutation; one-click link to the agent run trace."
> "Publishing a definition whose agents have failing eval gates raises a Problems-panel **warning** (publish proceeds — evals gate agents, not workflows)."

**(b)** Threshold field already exists end-to-end: `data/activity-config-schemas.ts:108-130` (`onResult: z.union([{ autoApproveThreshold: z.number().min(0).max(1) }, { alwaysAsk: z.literal(true) }])`); UI `components/fields/AgentInvokeConfigField.tsx` (radio + numeric input, default `0.8`, step `0.05`); runtime `packages/enterprise/.../dispositionService.ts:39-45` with the fail-closed comment *"Fail-closed: a missing / null confidence is treated as below threshold."*
Trace link precedent to copy: `packages/enterprise/.../backend/caseload/[proposalId]/page.tsx:211-219` → `/backend/traces/{runId}`. Eval gate: `lib/eval/evalGate.ts`, `AgentRun.evalPassed` (`data/entities.ts:557`). Publish route: `api/definitions/[id]/publish/`.

**(c)** The slider is a **presentation change over an existing field** — keep the `>=` compare, the `0.8` default and the fail-closed branch byte-identical (see gate analysis). Draft cards + trace link go on the instance detail page beside the parked-step row; `processId`/`stepId` correlation already exists on `AgentRun` (`data/entities.ts:93,96`). Eval warning is an additive Problems-panel entry at publish; the peer is OPTIONAL — degrade silently when `agentWorkflowBridge` is absent (`lib/server-output-contract.ts:79-101` is the existing tryResolve precedent).

**(d)** `components/__tests__/agentInvokeConfigField.test.tsx`; `api/definitions/[id]/__tests__/` publish-warning test; integration `TC-WF-056` (pending proposal renders as a draft card with a working trace link).

---

## §8 — Testing, debugging & observability (run-debugging; separable from §7)

### 8.1 / 8.2 — Dry-run, isolation flags, step-through

**(a)** > "**Dry-run (full graph):** a test run with registry `mock`s in place of effectors … Output: the **"Would do" report**. `mock: 'refuse'` types stop the dry-run at that node."
> "**Dry-run isolation (the leaks closed):** dry-run instances carry an `isDryRun` flag (additive column) that (a) **suppresses real USER_TASK creation** …; (b) defaults **INVOKE_AGENT to pinned/SAMPLE outcomes**; opting into a *real* agent run tags the `AgentRun` as dry-run … **excluded from the Work Inbox, Caseload, and KPI rollups** and **never reaches `dispositionService.dispose`** …; (c) keeps ACTION-type business rules un-triggerable; (d) excludes the instance from KPIs."
> "**Step-through:** "pause at each step" on test runs — inspect context, continue/abort, canvas highlights the active node."

**(b)** Head start is large: the mock contract already exists — `lib/activity-registry.ts:61` `mock?: ((config, ctx) => unknown) | 'refuse'`, with **9 of 10 built-ins already declaring one** (`lib/activity-types.ts:188,205,229,253,275,297,320,338`). The single-node runner that consumes it: `api/definitions/[id]/test-step/route.ts` (*"this route NEVER calls `entry.execute`"*) + `components/fields/ActivityTestPanel.tsx`. **The one gap is INVOKE_AGENT** — `lib/activity-types.ts:357` comments *"No mock: agent runs are not simulatable here."* §8.2(b) requires exactly that mock (pinned/SAMPLE outcome). Pin precedence already exists: `lib/sample-resolver.ts`, `metadata.editor.samples`.
`WorkflowInstance` has **no `isDryRun` column** (`data/entities.ts:392-469`) — additive migration + snapshot. Work Inbox filter points: `lib/work-inbox/user-task-source.ts` and enterprise `lib/workInbox/agentDispositionSource.ts:92-112` (`buildAgentDispositionWhere` already filters `source:'runtime'` — add the dry-run exclusion beside it). KPI rollup: `packages/enterprise/.../lib/metrics/metricRollupService.ts`.

**(c)** Order: (1) add an INVOKE_AGENT `mock` returning the pinned/SAMPLE outcome; (2) `isDryRun` column + start-test flag; (3) thread it through `lib/task-handler.ts` (suppress USER_TASK + notification subscriber), the bridge args (tag `AgentRun`), and the two inbox `where` builders; (4) "Would do" report = ordered list of mock returns, reusing `ActivityTestPanel`'s refusal rendering; (5) step-through as an instance-level pause between steps in `lib/workflow-executor.ts` — see gate analysis.

**(d)** `lib/__tests__/activity-registry.test.ts`, `activity-types.test.ts`, `sample-resolver.test.ts`, `task-handler-scoping.test.ts`, `work-inbox-provider.test.ts`; `api/__tests__/test-step.route.test.ts`. Integration `TC-WF-057` — the spec's required assertions: *"assert: no notification rows, no real UserTask, no pending proposal in inbox queries, `isDryRun` excluded from KPIs"*.

### 8.3 — Execution overlay, Gantt, live SSE, run-list filters

**(a)** > "**Overlay on the Studio canvas:** "Show last run" paints node states with DS status tokens … clicking a node shows its I/O in the inspector."
> "**Run detail — three altitudes**: **Flow** (painted canvas), **Timeline** — a true clock-time **Gantt** … with collapsed-wait rendering …, **Context**. The raw event table is demoted to a "Raw" tab."
> "**Per-step I/O inspector** (input, output, duration, attempts — from `StepInstance`)."
> "**Live:** `workflows.instance.*` lifecycle events gain `clientBroadcast: true`; run views subscribe via the DOM Event Bridge."
> "**Run list:** filters by definition, status, correlationKey, date; saved filters."

**(b)**
- Instance detail today is a **single 921-line scroll page, not tabs**: `backend/instances/[id]/page.tsx` — overview `:524-619`, painted read-only graph `:621-663` (node status derived from `WorkflowEvent` at `:266-389`), compensation `:666-716`, context/metadata JSON `:740-751`, "Execution Timeline" (event cards, **not** a Gantt) `:753-807`, raw event table `:809-880`.
- **`StepInstance.inputData`/`outputData`/`executionTimeMs`/`retryCount` are recorded but surfaced nowhere** — zero `StepInstance` references in any `api/` or `backend/` file. A new read route is required before the per-step I/O inspector or the Gantt can exist.
- Studio canvas has **no** overlay: hook point is `components/WorkflowGraphImpl.tsx` (default export `:154`, `nodeTypes` map `:355-374`), rendered from `backend/definitions/visual-editor/page.tsx:3094,3321`. Reuse `lib/status-colors.ts` (`STEP_STATUS_STYLES`).
- Events: `events.ts:18-28` — none of `workflows.instance.*` carry `clientBroadcast`. Flag type at `packages/shared/src/modules/events/types.ts:73`. Client hook `packages/ui/src/backend/injection/useAppEvent.ts:46`.
- Run list filters today (`backend/instances/page.tsx:260-300`): status, workflowId, correlationKey, entityType, entityId. **No date filter, no saved filters, and no `attention` control** — though `GET /api/workflows/instances?attention=` already works (`api/instances/route.ts:74,138-144`).
- Boy-Scout debt in scope: `backend/instances/[id]/page.tsx:669,685` still hardcodes `border-orange-300 / bg-orange-50 / text-orange-800`; `components/WorkflowLegend.tsx:17-49` uses raw `emerald/blue/yellow` shades that no longer match `STATUS_COLORS` (`analysis:396`).
- **Adjacent defect, cheap to fix here:** `backend/instances/page.meta.ts:3` and `[id]/page.meta.ts:3` gate on `requireFeatures: ['workflows.view_instances']`, a feature id that **does not exist in `acl.ts`**. The real id is `workflows.instances.view`, which `setup.ts:46` grants to `employee`. Wildcard `workflows.*` masks it for admins; a plain employee is locked out of both instance pages.

**(c)** Restructure the detail page into Flow / Timeline / Context / Raw tabs; add `GET /api/workflows/instances/[id]/steps` (feature `workflows.instances.view`) returning `StepInstance` rows; build the Gantt from `enteredAt`/`exitedAt`/`executionTimeMs` with collapsed-wait rendering; add `clientBroadcast: true` to the six `workflows.instance.*` lifecycle events and subscribe both run views; add date + `attention` + saved filters to the list. Fix the DS tokens and the meta-feature id while in-file.

**(d)** `api/__tests__/instances.route.test.ts`, new steps-route test, `lib/__tests__/instance-lifecycle-events.test.ts`, `event-logger.test.ts`, `status-colors-ds.test.ts`, `__tests__/acl-dependencies.test.ts`. Integration `TC-WF-058` (execution overlay after a run — a spec-required Playwright path), `TC-WF-059` (live SSE updates a run view).

### 8.4 — Rerun-from-step + failure queue/bulk replay  ⚠️ Ask-First

**(a)** > "**Rerun from failed step**, optionally with edited context — audited as `STEP_RERUN { editedContextDiff, by }`, gated by its own ACL feature (§ ACL), enabled by §7.4."
> "**Failure queue + bulk replay:** `Send to failure queue` directive parks instances as ATTENTION; with FAILED instances they form a triage list with error grouping; bulk retry/cancel runs through the progress module."
> ACL appendix: "`workflows.instances.rerun_step` (admins/devs) · `workflows.instances.bulk_ops` (admins)".

**(b)** Failure-queue half is largely built: marker `WorkflowInstanceAttention` (`data/entities.ts:210-215`, doc comment at `:207` literally says *"the Phase 5 triage UI consumes it"*), writer `lib/workflow-executor.ts:891-920` (`parkInstanceForAttention`, logs `ERROR_PARKED`), API filter `api/instances/route.ts:74,138-144`. Missing: the UI filter, the triage page, error grouping, and any bulk action (the list has **no** `data-table:*:bulk-actions` spot and no multi-select). Progress module contract: `packages/core/src/modules/progress/AGENTS.md`.
Rerun half is greenfield: `WorkflowEventTypes` (`lib/event-logger.ts:20-87`) has **no `STEP_RERUN`**; `acl.ts` has **neither** new feature (24 features today, `workflows.definitions.test_run` is the newest); no `isDryRun`/`rerun` route exists. Structural-drift guard to reuse: `lib/definition-edit-safety.ts:136,187-188`.

**(c) What rerun-from-step actually requires** (see gate analysis for the state-machine question):
1. Two ACL features + `setup.ts` `defaultRoleFeatures` + a row each in `__tests__/acl-dependencies.test.ts` (that test asserts the dependency table explicitly) + `yarn mercato auth sync-role-acls` in the release runbook.
2. `POST /api/workflows/instances/[id]/rerun-step` `{ stepId, contextPatch? }`.
3. **Create a NEW `StepInstance` row rather than mutating the terminal one.** The old row keeps its terminal status, a fresh `PENDING` row is inserted, `instance.currentStepId` is repointed, `pendingTransition` and `metadata.attention` are cleared. This sidesteps *"never set status out of order"* entirely and preserves the audit — propose it explicitly when asking.
4. New `STEP_RERUN` event type carrying `{ editedContextDiff, by }`.
5. Refuse the rerun when `definition-edit-safety`'s structural signature has changed since the instance started, and when the target step parked (needs §7.4's addressable resume token — otherwise an orphan queue job and an orphan proposal survive the rerun). **This is the §7.4 dependency the roadmap names.**
6. Bulk replay through `ProgressJob` + a queue worker, mutations via commands (`progress/AGENTS.md` MUST rules 1–5).

**(d)** New `lib/__tests__/rerun-from-step.test.ts`; extend `event-logger.test.ts`, `definition-edit-safety.test.ts`, `acl-dependencies.test.ts`, `workflow-executor.test.ts`. Integration `TC-WF-060` (rerun-from-step, ACL-gated + audit event — spec-required), `TC-WF-061` (failure-queue triage + bulk replay).

### Code view stage 2 (two-way sync + squiggles)

**(a)** Roadmap: "**Code view stage 2 (two-way sync + squiggles)**". Stage 1 shipped read-only + copy/paste.
**(b)** `components/WorkflowCodeView.tsx` (139 ln) — a right `Drawer`; its own header says *"Two-way live sync is Phase 5, so nothing here edits"*. Issue plumbing: `lib/collect-validation-issues.ts`; clipboard format `lib/subgraph-clipboard.ts`; page owns the splice + undo entry (`backend/definitions/visual-editor/page.tsx`). Undo stack: `lib/editor-history.ts`.
**(c)** Make the textarea editable, parse-on-change against `workflowDefinitionSchema`, project structured issues as inline squiggles, and push each accepted edit as one entry on the existing `editor-history` stack (not a second history). Guard the round-trip with the same `definitionToGraph → graphToDefinition` fixture the outcome-route PR adds.
**(d)** `backend/definitions/visual-editor/__tests__/codeView.test.tsx`, `lib/__tests__/editor-history.test.ts`, `subgraph-clipboard.test.ts`. Integration `TC-WF-062` (edit JSON → canvas updates → save round-trips).

---

## Risks / unknowns — Ask-First gates first

**G1 (hard). `agent_orchestrator/AGENTS.md:32`** — *"Ask before changing disposition threshold semantics, the auto-approve vs `user_task` boundary, or the no-bypass flush-time enforcer (`agentNoBypassSubscriber`)."*
- **§7.5 disposition SLAs — tripped, most seriously.** "nobody disposed in 2 days → **auto-reject**" is a *disposition reached without a human*. That is the boundary itself, not a route around it. Get an explicit decision on whether auto-reject-on-breach is permitted at all, or whether the only sanctioned breach outcomes are escalate/reassign/notify.
- **§7.5 Review (Who/When) — tripped.** It rewrites what `dispositionService.createUserTask` (`:135-144`) writes. It does not move *who decides*, but it edits the guarded file's `user_task` arm.
- **§7.6 threshold slider — NOT tripped as scoped.** It re-renders `onResult.autoApproveThreshold`, an existing schema field, as a slider. It **becomes** tripped the moment it changes the `>=` compare, the `0.8` default, the 0–1 range, or the fail-closed `typeof !== 'number'` branch. State in the PR that none of those changed.
- **§7.2 rejection/error split — not tripped.** It reads `disposition`; it does not decide it.
- **A7 — see G4.**

**G2 (hard). `workflows/AGENTS.md` Ask-First** — *"Ask before changing workflow, step, or activity state machines."*
- **§8.4 rerun-from-step — tripped** on its face (a terminal step becoming runnable again). The new-`StepInstance`-row design above avoids the literal violation; put that design in the ask.
- **§7.4 `parkStep`/`resumeStep` — tripped.** It replaces how a step suspends. Low behavioural risk (it formalises what already happens) but it is unambiguously the step state machine.
- **§8.2 step-through — borderline.** As an instance-level `PAUSED` between steps it stays inside the documented machine; as a new step status it does not. Design it as the former.
- `isDryRun` column, `STEP_RERUN` event type, new ACL features, the `transitionKindSchema` enum extension: all **additive**, no gate — but the migration needs `yarn db:generate` review and a snapshot, never `yarn db:migrate` (core AGENTS.md Ask-First).

**G3. Contract surfaces (`BACKWARD_COMPATIBILITY.md`).** Extending `transitionKindSchema` means an *older engine* zod-rejects a newer definition. `minEngineVersion` (`data/entities.ts:198`) is the sanctioned answer — bump it on definitions that use `kind:'outcome'`, and verify the refuse-to-instantiate path actually fires. `agent_orchestrator.proposal.ready` must stay dual-listened ≥1 minor per §BC.

**G4. A7 — can it be done without touching the auto-approve boundary?** Technically yes, semantically it still needs the ask.
The design doc is explicit (`.ai/analysis/2026-07-28-task-visibility-design.md:364`): *"Fixing it means calling into the workflows task handler from the dispose path in `dispositionService.ts`. That is **completing a loop the design already assumes**, not moving the auto-approve boundary — but it is the same file the Ask-First rule guards, so **get an explicit maintainer OK before touching it** and land it as its own PR with its own tests."* It is filed as step 21, *"(Separate PR, separate Ask-First)"*, and listed as open item 4 at `:752`.
**Assessment.** The cheapest correct shape: record the created `UserTask.id` on the proposal at `createUserTask` time (additive), then complete that task from `commands/dispose.ts` — which already runs on **every** disposition path including auto-approve's `skipResume: true` call (`dispositionService.ts:99-101`). `shouldAutoApprove` (`:39-45`) is never read or edited. So the *boundary* is untouched; the *file* is not. Phase 5 is the right home (§7.5 is already rewriting `createUserTask`), but ask before starting, and land it as its own commit inside PR B with its own tests so it can be reverted independently.

**G5. Non-gated unknowns.**
- `slaBreach` silently downgrades on canvas save (`graph-utils.ts:234`) — a live correctness bug PR A must fix, not just route around.
- `workflows.view_instances` does not exist in `acl.ts`; both instance page metas require it. Employees granted `workflows.instances.view` cannot open either page.
- `#4424` (activity timeout unreachable: UI writes `timeoutMs`, schema accepts `timeout`, executor reads `timeoutMs`) and `#4323` (instance-detail visual flow shows "definition not found" for code-defined workflows — synthetic UUID vs `code:<workflowId>` lookup) both sit directly on §8.3's surface. `#4323` will make the execution overlay look broken for code-defined flows; fix or explicitly scope out.
- No open issue names Phase 5 (`#4251` umbrella closes at C7/`#4250`; roadmap says *"Closes: — (all GAP work)"*). Nothing to link; consider filing a Phase 5 tracking issue.
- 60-node density acceptance (§4.4) must be **re-measured**, not assumed, after the footer + gap-6 batch.

---

## Proposed PR split — recommended: 4 PRs, in this order

| PR | Scope | Ask-First | Depends on |
|---|---|---|---|
| **A — Outcome routes & node face** (§7.2, §7.3, fidelity gap 6) | `lib/outcome-routing.ts`; `transitionKindSchema` + `outcomeKind`; the four exclude-filters + `route-priority`; generalised handle→kind round-trip in `graph-utils`/`edge-reattachment`/`handleConnect` **incl. the `slaBreach` retrofit**; outcome + decision footer rows on `InvokeAgentNode`/`UserTaskNode`; guardrail-block discriminator on the bridge outcome; rejection/error split; node-dimension dedupe + config-summary line + outcome-aware `estimateNodeSize`; 60-node re-measure. | **No** | — |
| **B — Disposition contract** (§7.4, §7.5, §7.6, §7.7, A7, gap 7a) | `parkStep`/`resumeStep` + dual-listened signal; Review (Who/When) on the agent inspector; disposition SLAs via the breach route; threshold slider; draft cards + trace links; eval-gate publish warning; `delegation_grant.revoked` subscriber; A7 as its own revertible commit; inspector spacing/overline tightening. | **Yes — G1 + G2 + G4.** Resolve all three before starting. | A (the `rejected`/`error`/`slaBreach` routes must exist before an SLA can route to one) |
| **C — Run views & recovery** (§8.3, §8.4) | Flow/Timeline/Context/Raw tabs; `GET .../instances/[id]/steps` + per-step I/O inspector; Gantt with collapsed waits; `clientBroadcast` on `workflows.instance.*` + live subscribe; Studio "Show last run" overlay; run-list date/`attention`/saved filters; failure-queue triage + error grouping + bulk replay via progress; rerun-from-step + 2 ACL features + `STEP_RERUN`; DS-token and `view_instances` cleanups. | **Yes — G2** (rerun-from-step only). The rest is ungated; if the gate stalls, ship C without rerun and follow up. | B for rerun-from-step **only** — everything else can run in parallel with B |
| **D — Dry-run, step-through & Code view stage 2** (§8.1, §8.2, Code view) | INVOKE_AGENT `mock`; `isDryRun` column + isolation across USER_TASK/notifications/Work Inbox/Caseload/KPIs/`dispositionService.dispose`; "Would do" report; step-through; two-way Code view + squiggles. | **G2 (soft)** for step-through; the isolation clause "never reaches `dispositionService.dispose`" brushes G1 — confirm it counts as a bypass, not a boundary move. | A (canvas), C (run views host the report) |

**Why not two PRs.** §7 and §8 are genuinely separable — different files, different reviewers, different gates — but §7 alone is still too large: PR A is pure engine+canvas mechanics with no Ask-First and can merge fast, while PR B is blocked on three maintainer decisions. Splitting them means the ungated 60% of §7 ships while the gates are being resolved. Likewise C's run views are ungated and can land alongside B; only rerun-from-step waits.

**Critical path:** A → (gates resolved) → B → C-rerun. C-views and D-codeview can run parallel from the moment A merges.
