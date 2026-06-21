# 02 · Workflows INVOKE_AGENT Activity

> **Status:** Ready to implement · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20
> **Module:** `workflows` (core change, owner-approved) · **Depends:** [01 agent-sdk-core](01-agent-sdk-core.md)
> **Area of:** [mvp/00-overview.md](00-overview.md) — conforms to its §Shared Contracts (this index wins on conflict).

## TLDR

Add `INVOKE_AGENT` as a **first-class, additive** activity type to the core `workflows` module. On execute, the activity calls `agent_orchestrator.agentRuntime.run(...)` over DI (no ORM relation), persists an `AgentProposal` stamped with `process_id` + `step_id`, then calls area 03's `dispositionService.dispose` **inline**: **auto-approve → proceed without parking**; **ask-a-human → park like `WAIT_FOR_SIGNAL`** and resume when `agent_orchestrator.proposal.ready { processId, stepId, proposalId }` fires (a subscriber calls `sendSignal`). The threshold logic is **owned by area 03**; this area calls the service and reacts to the outcome. The change is small and safe: the activity-type list lives in TS + Zod only (definitions persist as `jsonb`, **no DB enum, no migration**), and a one-node "Invoke Agent" editor entry authors the step.

## Scope

- **In:** the additive `INVOKE_AGENT` activity-type (TS union + Zod enum), the executor case, its config Zod schema, the park-then-resume contract, the resume subscriber wiring contract, the visual-editor node + 3-field config panel, BC handling, tests, snapshot note.
- **Out (area 03):** the dispose Command/API, the threshold/`USER_TASK` decision logic, the proposal read APIs. **Out (area 01):** `defineAgent`, `agentRuntime`, `AgentRun`/`AgentProposal` entities. **Out:** dispatch/A2A, any change to other activity types or step types.

## What exists today (proof the change is small & additive)

**The activity-type union is a closed hand-written switch in two places — both TS-only.** `packages/core/src/modules/workflows/lib/activity-executor.ts:51`:

```ts
export type ActivityType =
  | 'SEND_EMAIL' | 'CALL_API' | 'EMIT_EVENT' | 'UPDATE_ENTITY'
  | 'CALL_WEBHOOK' | 'EXECUTE_FUNCTION' | 'WAIT'
```

re-declared as a Zod enum at `data/validators.ts:108` (`activityTypeSchema = z.enum([...])`, `type ActivityType = z.infer<...>`), validated into `activityDefinitionSchema` (`data/validators.ts:206`). The switch is `executeActivityByType()` (`activity-executor.ts:407`) with a `default:` that throws `Unknown activity type` — the **`default` path is untouched, so every pre-existing definition runs unchanged**.

**There is NO persisted activity-type DB enum.** Definitions (including `activities[].activityType`) are stored in `WorkflowDefinition.definition` — a single `jsonb` column (`data/entities.ts:179`, `@Property({ name: 'definition', type: 'jsonb' })`). Grep confirms no migration and no `.snapshot-open-mercato.json` row references `activityType`/`activity_type`/`SEND_EMAIL`. **⇒ widening the union requires no DDL and no migration.** (Contrast GAP-03's earlier assumption of an `activityType` `varchar` column — verified false against the real schema.)

**Parking + resume already exist and are proven.** `WAIT_FOR_SIGNAL` is a *step type*; `handleWaitForSignalStep()` (`lib/step-handler.ts:761`) sets `instance.status = 'PAUSED'`, stamps `pausedAt`, flushes, and returns `{ status: 'WAITING', waitReason: 'SIGNAL' }` to halt the executor. `sendSignal()` (`lib/signal-handler.ts:59`) requires `status === 'PAUSED'`, asserts the current step is `WAIT_FOR_SIGNAL`, matches `signalConfig.signalName` (falling back to `stepId`, `signal-handler.ts:207`), merges the signal payload into `instance.context` (`signal-handler.ts:218`), exits the step, runs `auto` transitions, and resumes via `workflowExecutor.executeWorkflow(...)`. **Branch-scoped resume for `FORKED` instances is already handled** (`signal-handler.ts:94`). `EXECUTE_FUNCTION` proves DI-service calls from an activity: `executeFunction()` (`activity-executor.ts:767`) resolves `workflowFunction:<name>` and calls it.

**Key design fact:** activities are *transition-level* and return output (`executeActivities`, `activity-executor.ts:341`); parking is *step-level*. `INVOKE_AGENT` therefore **reuses the existing `WAIT_FOR_SIGNAL` step park** — it does not invent a new park channel (avoiding the `WAITING_FOR_ACTIVITIES` resume-channel trap, `step-handler.ts:471`).

## Files to modify (all under `packages/core/src/modules/workflows/`)

| File | Change |
|---|---|
| `lib/activity-executor.ts` | Add `'INVOKE_AGENT'` to `ActivityType` (`:51`); add `case 'INVOKE_AGENT':` in `executeActivityByType()` (`:407`); add `executeInvokeAgent()` handler. |
| `data/validators.ts` | Add `'INVOKE_AGENT'` to `activityTypeSchema` (`:108`); add `invokeAgentConfigSchema`; add a `superRefine` branch on `activityDefinitionSchema` (`:218`) validating the config when `activityType === 'INVOKE_AGENT'`. |
| `data/entities.ts` | Add `'INVOKE_AGENT'` to the `WorkflowStepType` union? **No.** `INVOKE_AGENT` is an activity, not a step. **No entity change.** (Listed to make the "no DB change" decision explicit.) |
| `lib/node-type-icons.ts` | Add an `invokeAgent` `NodeType` + icon/color/label + `STEP_TYPE_TO_NODE_TYPE` entry (for the editor node — see §The change/5). |
| `components/nodes/InvokeAgentNode.tsx` (new) + `components/nodes/index.ts` + `components/WorkflowGraphImpl.tsx` (`:127` `nodeTypes`) | Register the "Invoke Agent" React Flow node. |
| `components/NodeEditDialog.tsx` | Add the 3-field config panel (agent · input · on-result) for the `invokeAgent` node. |
| `components/ActivitiesEditor.tsx` | Add `{ value: 'INVOKE_AGENT', label: 'Invoke Agent' }` to `ACTIVITY_TYPES` (`:39`) so it is selectable in the advanced activities list too. |
| `i18n/{en,es,de,pl}.json` | Add `workflows.activityTypes.INVOKE_AGENT`, `workflows.nodeTypes.invokeAgent`, `workflows.form.invokeAgent.*` labels. |
| `subscribers/agent-proposal-ready.ts` (new) | Resume subscriber on `agent_orchestrator.proposal.ready` (see §The change/4 + §Cross-module wiring). |
| `migrations/.snapshot-open-mercato.json` | **No change expected.** Run `yarn db:generate` as a diff probe; if it emits unrelated drift, discard it (definitions are `jsonb`; the widened enum is not persisted as a column). |

## The change

### 1 · Additive activity-type (TS union + Zod enum)

`activity-executor.ts:51` and `validators.ts:108` — append `'INVOKE_AGENT'` to both. **Additive only**: no value removed or renamed; existing definitions stay valid; Zod still rejects unknown types. Follows `BACKWARD_COMPATIBILITY.md` §2 (Type Definitions, STABLE — additive widening is allowed).

### 2 · Executor case — run agent, create proposal, park

Add to `executeActivityByType()` (`activity-executor.ts:407`):

```ts
case 'INVOKE_AGENT':
  return await executeInvokeAgent(em, interpolatedConfig, context, container)
```

`executeInvokeAgent(em, config, context, container)`:

1. Validate `config` against `invokeAgentConfigSchema` (defensive — already validated at author time).
2. Resolve the agent runtime via DI **without an ORM relation** — `const runtime = tryResolve(container, 'agentRuntime')`; if absent, throw `[internal] agent_orchestrator not installed` (graceful module-decoupling — see §Cross-module wiring).
3. `const ctx = { tenantId: instance.tenantId, organizationId: instance.organizationId, userId: context.userId }`.
4. `const result = await runtime.run(config.agentId, config.input, ctx)` (`config.input` already interpolated by `interpolateVariables`, `activity-executor.ts:405`, so `{{deal.id}}` is resolved before the call).
5. `agentRuntime.run` persists the `AgentRun` and (for `kind:'actionable'`) the `AgentProposal` (area 01). This case stamps the proposal's `process_id = context.workflowInstance.id` and `step_id = context.stepContext?.stepId` by passing them in `ctx` so area 01 records them (the proposal carries `process_id`/`step_id` per the FROZEN entity in 00-overview §Entities).
6. **Informative result** (`result.kind === 'informative'`): return `{ kind:'informative', agentRunId, data: result.data }` as the activity output — `executeActivities` merges it into `workflowContext` under the activity name (`activity-executor.ts:378`) and the step **does not park** (it proceeds, per the actionability ladder).
7. **Actionable result** (`result.kind === 'actionable'`): **call the disposition seam INLINE** — `const outcome = await tryResolve(container, 'dispositionService').dispose(proposal, config.onResult, ctx)` (area 03; `ctx` carries `processId`/`stepId`). Two outcomes:
   - `outcome.kind === 'auto_approved'` (confidence ≥ threshold) → area 03 already disposed the proposal via the audited dispose Command; **return `{ kind:'actionable', agentRunId, proposalId, disposition:'auto_approved' }` and DO NOT park** — the step proceeds to the next (effector) transition. **No `proposal.ready` is emitted on this path** (avoids parking-before-signal).
   - `outcome.kind === 'user_task'` (below threshold / `alwaysAsk` / `null` confidence) → area 03 raised a `USER_TASK`; **return `{ kind:'actionable', agentRunId, proposalId, parkSignal:'agent_orchestrator.proposal.ready' }` and the host step PARKS**. The operator's dispose endpoint later emits `proposal.ready` → resume.

**How the park happens (load-bearing).** Parking is conditional on the inline disposition outcome above. The "Invoke Agent" editor node (§5) compiles to an `AUTOMATED` step carrying the `INVOKE_AGENT` activity **plus `signalConfig.signalName = 'agent_orchestrator.proposal.ready'`**. After `executeActivities`, `executeStep` (`step-handler.ts:454`) inspects the activity result: only when it is `{ kind:'actionable', parkSignal }` (the `user_task` outcome) does it set `instance.status = 'PAUSED'` + `pausedAt` and return `{ status:'WAITING', waitReason:'SIGNAL' }` — **identical to `handleWaitForSignalStep()`** (`step-handler.ts:792`, reuse the `PAUSED` block at `:796`). An `auto_approved` (or `informative`) result returns no `parkSignal`, so the step proceeds normally. One park channel, one resume path, no auto-path race.

### 3 · Config Zod schema

In `data/validators.ts` (the three editor fields from the hackathon sketch §Pillar 2):

```ts
export const invokeAgentConfigSchema = z.object({
  agentId: z.string().min(1, 'Agent is required'),            // dropdown of defineAgent() ids
  input: z.record(z.string(), z.any()).default({}),            // context-expression map, e.g. { dealId: '{{deal.id}}' }
  onResult: z.union([
    z.object({ autoApproveThreshold: z.number().min(0).max(1) }),
    z.object({ alwaysAsk: z.literal(true) }),
  ]),
})
export type InvokeAgentConfig = z.infer<typeof invokeAgentConfigSchema>
```

Wire it into `activityDefinitionSchema.superRefine` (`validators.ts:218`) mirroring the existing `WAIT` branch (`:219`): when `activityType === 'INVOKE_AGENT'`, parse `config` with `invokeAgentConfigSchema` and surface issues on `['config']`. `onResult` is **carried on the proposal/context for area 03** — this area neither evaluates the threshold nor raises the `USER_TASK` (that is the disposition seam).

### 4 · Resume on `agent_orchestrator.proposal.ready`

New subscriber `subscribers/agent-proposal-ready.ts`:

```ts
export const metadata = { event: 'agent_orchestrator.proposal.ready', persistent: true, id: 'wf-agent-proposal-ready' }
export default async function handler(payload, ctx) {
  // payload: { processId, stepId, proposalId, tenantId, organizationId }
  const signalHandler = ctx.container.resolve('signalHandler')   // or resolve sendSignal via DI
  await signalHandler.sendSignal(ctx.em, ctx.container, {
    instanceId: payload.processId,
    signalName: 'agent_orchestrator.proposal.ready',
    payload: { proposalId: payload.proposalId, stepId: payload.stepId },
    tenantId: payload.tenantId, organizationId: payload.organizationId,
  })
}
```

`sendSignal` (`signal-handler.ts:59`) then merges `{ proposalId }` into `instance.context` (so downstream effector steps can read `{{signal_agent_orchestrator.proposal.ready_payload.proposalId}}` or the disposed proposal payload), runs the `auto` transitions out of the parked step, and resumes. Branch-scoped (`FORKED`) instances resume the correct branch automatically (`signal-handler.ts:94`).

> **Who emits `proposal.ready`?** **Only the human-dispose path** — area 03's dispose endpoint on Approve/Edit/Reject (the instance is parked). The **auto-approve path does NOT emit it**: `dispositionService` disposes inline and the executor proceeds without ever parking (no signal needed → no park-before-signal race). This area only **consumes** `proposal.ready`. The event id + payload shape are FROZEN in 00-overview §Events.

### 5 · Visual-editor "Invoke Agent" node + 3-field config panel

- `lib/node-type-icons.ts`: add `'invokeAgent'` to `NodeType` (`:3`); add icon (`Bot` from lucide), `NODE_TYPE_COLORS.invokeAgent: 'text-primary'` (**DS token, no hardcoded shade** — note existing entries like `waitForSignal: 'text-purple-500'` are legacy; new entry uses a semantic token per DS rules), `NODE_TYPE_LABELS.invokeAgent`, and `STEP_TYPE_TO_NODE_TYPE` so the node round-trips. The node compiles to an `AUTOMATED` step + `INVOKE_AGENT` activity + `signalConfig.signalName='agent_orchestrator.proposal.ready'`.
- `components/nodes/InvokeAgentNode.tsx` (new) + export from `components/nodes/index.ts` + register in `components/WorkflowGraphImpl.tsx` `nodeTypes` map (`:127`, alongside `automated`, `waitForSignal`). The node renders live status `▶ running · ⏸ waiting for approval · ✓ done` (status from the instance/step state — reuses the monitor's status badge, DS status tokens).
- `components/NodeEditDialog.tsx`: add an `invokeAgent` branch (mirroring the `waitForSignal` branch at `:215`) with **exactly three fields**: **Agent** (`Select` populated from `GET /api/agent_orchestrator/agents`), **Input** (key→expression rows, default `{ dealId: '{{deal.id}}' }`), **On result** (radio: *Auto-approve if confidence ≥* `[0.8]` number input | *Always ask a human*). On save, write `config = { agentId, input, onResult }` and `signalConfig.signalName = 'agent_orchestrator.proposal.ready'`.

## Cross-module wiring (no ORM relation)

- `workflows` resolves `agent_orchestrator`'s `agentRuntime` **by DI key only** via a local `tryResolve(container, 'agentRuntime')` helper (the `inbox_ops`/`shipping_carriers` optional-peer pattern). `agent_orchestrator` is an **optional peer** of `workflows`: if absent, `INVOKE_AGENT` activities fail with a clear `[internal]` error rather than hard-requiring the module. `workflows` MUST NOT add a `requires` on `agent_orchestrator` (that would invert the dependency and break `workflows` isomorphism — `agent_orchestrator` already depends on `workflows`).
- **Disposition seam (area 03) — RESOLVED: inline call** (00-overview §Disposition seam, canonical). `INVOKE_AGENT` is propose-only: it creates an `AgentProposal` then **calls `dispositionService.dispose(proposal, onResult, ctx)` inline** (resolved via `tryResolve(container, 'dispositionService')`, the same optional-peer pattern as `agentRuntime`). It **never** evaluates the threshold itself, never raises a `USER_TASK`, never runs an effector — `dispositionService` (area 03) owns all of that and returns `{ kind:'auto_approved' }` (proceed, no park, no `ready`) or `{ kind:'user_task' }` (park on `ready`). The earlier "subscribe to `proposal.created`" option is **rejected** — it loses the activity's transaction scope and races `WAIT_FOR_SIGNAL`. `workflows` stays ignorant of *how* disposition decides (the threshold logic lives entirely in area 03); it only calls the service and reacts to the outcome.
- **"LLM proposes, OM disposes":** the agent layer returns a proposal; the workflow + gate (area 03) dispose; the approved action runs via a separate effector step (`EXECUTE_FUNCTION`/`CALL_API` under OM's authority, audited). `INVOKE_AGENT` is strictly a parking activity that yields a proposal — it never controls flow.

## API / Editor contracts

- **Editor → definition:** the "Invoke Agent" node serializes to a normal step in the `jsonb` `definition`: `{ stepId, stepType:'AUTOMATED', signalConfig:{ signalName:'agent_orchestrator.proposal.ready' }, activities:[{ activityType:'INVOKE_AGENT', config:{ agentId, input, onResult } }] }`. No new API route in `workflows`.
- **Agent dropdown source:** `GET /api/agent_orchestrator/agents` (area 01) — read-only, RBAC-gated by `agent_orchestrator.agents.view`.
- **Resume signal contract (FROZEN, 00-overview §Events):** event `agent_orchestrator.proposal.ready`, payload `{ processId, stepId, proposalId }` (+ tenant/org for scoping). `signalName` matches the parked step's `signalConfig.signalName`.
- **Workflow author ACL:** authoring the node is gated by `agent_orchestrator.workflows.author` (00-overview §ACL) in addition to the existing `workflows` definition-edit features.

## Backward Compatibility

- **Additive enum** in two TS/Zod locations — no removal/rename. `BACKWARD_COMPATIBILITY.md` §2 (Type Definitions, STABLE): additive widening is permitted; deprecation protocol **N/A** (nothing deprecated).
- **No DB schema change.** Definitions persist as `jsonb` (`entities.ts:179`); there is no `activityType` column or enum — so **no migration, no snapshot row** (§8 Database Schema is not engaged). Run `yarn db:generate` only as a drift probe and discard unrelated output.
- **Existing definitions valid & unchanged:** the switch `default` and every existing case are untouched; the new Zod `superRefine` branch is gated on `activityType === 'INVOKE_AGENT'` and cannot affect other types.
- **Tests:** (1) every pre-existing definition + the executor `default` path execute unchanged; (2) `activityTypeSchema` accepts `INVOKE_AGENT` and still rejects unknown types; (3) `invokeAgentConfigSchema` rejects missing `agentId` / malformed `onResult`; (4) park-then-resume: an `actionable` result parks (`status==='PAUSED'`, `waitReason==='SIGNAL'`) and `sendSignal('agent_orchestrator.proposal.ready')` resumes and advances; (5) an `informative` result does **not** park; (6) no-bypass: `INVOKE_AGENT` never runs an effector or controls flow directly; (7) module-decoupling: with `agent_orchestrator` absent, the activity fails closed and other workflows are unaffected (`packages/core/src/__tests__/module-decoupling.test.ts`).
- **Snapshot:** none expected; note explicitly in the PR that `yarn db:generate` produced no `workflows` migration.

## Phases

1. **Enum + Zod + config schema** — widen `ActivityType` (TS + Zod), add `invokeAgentConfigSchema` + `superRefine`. Unit tests (BC tests 1–3). *(P0)*
2. **Executor case + park** — `executeInvokeAgent`, the actionable-result park in `executeStep`, `tryResolve('agentRuntime')`. Tests 4–6. *(P0)*
3. **Resume subscriber** — `subscribers/agent-proposal-ready.ts` calling `sendSignal`; integration park→resume test. *(P0)*
4. **Visual editor node + panel** — `node-type-icons` entry, `InvokeAgentNode`, `nodeTypes` registration, `NodeEditDialog` 3-field panel, `ActivitiesEditor` option, i18n. *(P0 — the headline UX)*
5. **BC + decoupling tests + docs** — test 7, snapshot note, `workflows/AGENTS.md` "Activity Types" table row, `yarn generate && yarn typecheck && yarn lint && yarn test`. *(P0)*

## Acceptance

- A workflow definition with an "Invoke Agent" node (agent dropdown · input map · auto-approve threshold) **runs the agent** via `agentRuntime.run`, **creates an `AgentProposal`** stamped with `process_id`/`step_id`, and **parks** (`status='PAUSED'`, `waitReason='SIGNAL'`) — verified in the monitor as `⏸ INVOKE_AGENT`.
- On `agent_orchestrator.proposal.ready { processId, stepId, proposalId }`, the subscriber calls `sendSignal`, the instance **resumes**, the proposal id is in `instance.context`, and the next (effector) step runs — auto-approve (under threshold, area 03) and `USER_TASK` (over threshold, area 03) both resolve to the same `ready` resume.
- An **informative** result stores `data` in context and proceeds without parking.
- All execution is tenant-scoped (`tenantId` + `organizationId` on every query and on `sendSignal`); cross-tenant resume is rejected by `sendSignal`'s scoped instance lookup.
- Every pre-existing workflow definition and the executor `default` path execute unchanged; BC tests green.

## Risks & Impact Review

| # | Risk | Sev | Area | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | Contract-surface change to `workflows` activity-type list | Med | `workflows` TS + Zod | Owner-approved (Patryk Lewczuk); additive-only; deprecation N/A; BC tests 1–2 gate it | Low |
| 2 | Wrong resume channel — instance parks in `WAITING_FOR_ACTIVITIES` instead of the signal park | Med | executor/step-handler | Reuse the exact `handleWaitForSignalStep` park (`status='PAUSED'`, `waitReason='SIGNAL'`); never mark the `INVOKE_AGENT` activity `async`; test 4 asserts the park state | Low |
| 3 | Lost `proposal.ready` signal → instance dangles parked | Med | resume subscriber | Persistent subscriber (retried); optional `signalConfig.timeout` routes to a timeout transition (existing `WAIT_FOR_SIGNAL` timeout, `step-handler.ts:771`); dispatch/timeout sweeper is an area-03/overlay follow-up | Med |
| 4 | Enum drift — union widened in TS but not Zod (or vice-versa) | Low | TS/Zod | Both edits in one change; test 2 asserts Zod accepts the value; `typecheck` catches TS narrowing | Low |
| 5 | Saga/compensation interaction — parked agent step inside a compensated transition | Low | executor | The `INVOKE_AGENT` enqueue has no DB side effect to compensate (proposal is inert until disposed); a timed-out park routes to a failure branch, not a dangling instance | Low |
| 6 | `agent_orchestrator` absent at runtime | Low | DI | `tryResolve` optional-peer pattern; activity fails closed with `[internal]` error; test 7 (decoupling) | Low |
| 7 | Agent layer controls flow (violates "OM disposes") | Med | architecture | Structural: `INVOKE_AGENT` only creates a proposal + parks; disposition + effector are separate steps owned by area 03; no-bypass test 6 | Low |

## Integration Coverage

- **INVOKE_AGENT end-to-end park/resume:** start a definition whose step is `INVOKE_AGENT` → assert proposal created with `process_id`/`step_id` + instance `PAUSED` → emit `agent_orchestrator.proposal.ready` → assert resume + effector ran + proposal id in context.
- **Auto-approve path:** `onResult.autoApproveThreshold`, confidence ≥ threshold → area 03 auto-disposes and emits `ready` → workflow resumes without a `USER_TASK`.
- **USER_TASK path:** confidence < threshold (or `alwaysAsk`) → area 03 raises a `USER_TASK`; human Approve → `ready` → resume.
- **Informative path:** agent returns `informative` → no park, context carries `data`, workflow proceeds.
- **Tenant isolation:** a `proposal.ready` for a different tenant/org does not resume the instance (`sendSignal` scoped lookup throws `INSTANCE_NOT_FOUND`).
- **Existing workflows unaffected:** all current example definitions (`workflows/examples/`) and the executor `default` path run unchanged.

## Final Compliance Report

- **Owner-approved contract change** (2026-06-20, hackathon sketch §DECIDED): additive `INVOKE_AGENT` activity, no macro fallback.
- **Additive-only**, no DB migration (definitions are `jsonb`); deprecation protocol N/A.
- **No cross-module ORM relation** — `agentRuntime` resolved by DI key via optional-peer `tryResolve`; `workflows` adds no `requires` on `agent_orchestrator`.
- **Tenant-scoped** throughout (`tenantId` + `organizationId` on resolve, run ctx, and `sendSignal`).
- **DS + i18n compliant:** new node uses a semantic color token; all editor strings via `i18n/` + `useT()`; internal throws prefixed `[internal]`.
- **Reuses the proven park/resume path** (`WAIT_FOR_SIGNAL` step park + `sendSignal`) — one channel, no new engine surface.
- **"LLM proposes, OM disposes" preserved:** propose-only activity; disposition + effector owned by area 03.
- Validation: `yarn generate · yarn typecheck · yarn lint · yarn test` + the integration coverage above; `yarn db:generate` as a no-op drift probe.

## Changelog

- **2026-06-20:** Authored the implementation-ready first-class `INVOKE_AGENT` activity spec. Verified against real code: activity-type union is TS-only (`activity-executor.ts:51`) + Zod (`validators.ts:108`), definitions persist as `jsonb` (`entities.ts:179`) ⇒ **no migration/DB enum** (corrects GAP-03's `varchar`-column assumption); park reuses `handleWaitForSignalStep` (`step-handler.ts:761`) and resume reuses `sendSignal` (`signal-handler.ts:59`); editor nodes are step-typed via `STEP_TYPE_TO_NODE_TYPE` (`node-type-icons.ts:42`) and registered in `WorkflowGraphImpl` `nodeTypes` (`:127`), config panels in `NodeEditDialog`. Defined the disposition seam to area 03 as an **inline `dispositionService.dispose` call** (00 §Disposition seam; the subscribe-to-`proposal.created` option was rejected — it races `WAIT_FOR_SIGNAL`), with optional-peer DI wiring; the step parks **only on the human path** (auto-approve proceeds inline, no resume-signal race).
