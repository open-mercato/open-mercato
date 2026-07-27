# Investigation: INVOKE_AGENT steps "run forward" instead of pausing (sub-workflows)

**Date:** 2026-06-28
**Status:** Investigation / root-cause report (no fix applied)
**Area:** `packages/core/src/modules/workflows`

## Symptom (as reported)

- A parent workflow runs a sub-workflow containing many `INVOKE_AGENT` steps.
- When the sub-workflow starts, every agent step immediately logs **`STEP_ENTERED`**
  then **`SIGNAL_AWAITING`** ("Awaiting Signal") — but the instance does **not**
  actually wait; it keeps advancing ("runs forward") through all the steps in the
  same second and then ends (FAILED or, surprisingly, COMPLETED).
- One `INVOKE_AGENT` node (position 11) had **no agent configured**.
- Curious data point: after the user **configured one agent**, the agent step ran
  and the **whole sub-workflow was marked COMPLETED**.

Concrete evidence from the screenshots:
- `claims_value_assessment_v1` (#f230879b): **Failed**, current step `set_reserve`,
  start→complete 12:24:54→12:24:56. Its event log is a repeating burst of
  `Step Entered → Awaiting Signal → Transition Executed`, ending `Workflow Failed`.
- `claims_liability_assessment_v1` (#ed3a167d): **Completed**, all agent nodes green.
- `claims_resolution_*`: **Failed** at step `value` (the sub-workflow call).

## How an "Invoke Agent" node actually works (architecture)

There is **no `INVOKE_AGENT` step type**. An "Invoke Agent" node compiles to an
**`AUTOMATED` step** that carries a single `INVOKE_AGENT` *activity* plus a
`signalConfig`:

- node→step type map `invokeAgent: 'AUTOMATED'` — `lib/graph-utils.ts:578`
- node→activity compile (sets `signalConfig.signalName`) — `lib/nodeFormTransforms.ts:380-413`
- `INVOKE_AGENT` is an `ActivityType` — `lib/activity-executor.ts:59,464`

The agent runs **asynchronously**:
1. On entry, `handleAutomatedStep` → `executeActivities` → `executeInvokeAgent`
   (`lib/activity-executor.ts:923`) **enqueues** an `invoke_agent` queue job
   (`delayMs: 1000`) and returns a `__park` marker — it does **not** run the agent
   inline (`lib/activity-executor.ts:1013-1035`).
2. `handleAutomatedStep` detects `__park`, logs **`SIGNAL_AWAITING`**, sets
   **`instance.status = 'PAUSED'`**, and returns `{ status: 'WAITING' }`
   (`lib/step-handler.ts:516-545`).
3. Later, the `workflow-activities` worker runs the agent off-transaction
   (`lib/activity-worker-handler.ts:241-349`) and resumes the step by calling
   `sendSignal(...)` with the fixed signal name.

**The signal it waits for** is the constant
`INVOKE_AGENT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'`
(`lib/activity-executor.ts:67`). It is **the same for every agent step** — it is
not derived per-step. Instances are matched by id (`processId`), and the current
step is recognized as agent-parked via its `signalConfig.signalName` or, as a
relaxed fallback, by carrying any `INVOKE_AGENT` activity
(`lib/signal-handler.ts:210-230`). So the answer to "what signal should it wait
for" is: `agent_orchestrator.proposal.ready`, fired either by the activity worker
(informative / auto_approved outcomes) or by the agent_orchestrator human-dispose
path (`packages/enterprise/.../disposition/resume.ts`) for `user_task` outcomes.

## Root cause #1 (PRIMARY): the executor loop advances PAST a parked step

`executeWorkflow`'s main loop is at `lib/workflow-executor.ts:293-530`. Its only
stop conditions are:

- `currentInstance.status === 'FORKED'` → drive branches (line 306)
- `currentStep.stepType === 'END'` → complete (line 346)
- `currentStep.stepType === 'USER_TASK' | 'WAIT_FOR_SIGNAL' | 'WAIT_FOR_TIMER'`
  → return RUNNING / pause (lines 362-374)
- no auto transitions / no valid auto transitions → return RUNNING (382-417)
- `transitionResult.pausedForActivities` → return WAITING_FOR_ACTIVITIES (464-494)

**There is no check for `currentInstance.status === 'PAUSED'`.** Pausing is
detected indirectly by *step type*, not by the actual paused status the step set.

Trace for an agent step:
1. The loop takes the auto transition *into* the agent step and calls
   `transitionHandler.executeTransition` (line 422).
2. Inside `executeTransitionForToken`, the transition's **own** activities are
   empty (the `INVOKE_AGENT` activity lives on the *step*, not the transition), so
   `hasAsyncActivities` is false. It advances the cursor and calls
   `stepHandler.executeStep(toStep)` (`lib/transition-handler.ts:559`).
3. `executeStep` runs the agent step, which **parks** (`instance.status = 'PAUSED'`)
   and returns `{ status: 'WAITING' }`.
4. **`executeTransition` only handles `status === 'FAILED'`** (`lib/transition-handler.ts:595`).
   A `WAITING` result falls straight through to post-conditions and returns
   `{ success: true, nextStepId }` **without** `pausedForActivities`.
5. Back in the loop: `success` is true, `pausedForActivities` is falsy → it logs
   `TRANSITION_EXECUTED`, flushes, and **`continue`s**.
6. Next iteration: the instance is now `PAUSED` and `currentStepId` is the agent
   step — an **`AUTOMATED`** step, which is **not** in the wait-step-type guard.
   `PAUSED` is never checked, so the loop finds the next auto transition and
   repeats from step 1 for the next agent step.

This produces exactly the observed burst:
`STEP_ENTERED → SIGNAL_AWAITING → TRANSITION_EXECUTED` per step, all in one
synchronous `executeWorkflow` pass, never actually waiting for any agent.

**Why USER_TASK / WAIT_FOR_* don't have this problem:** they set `PAUSED` the same
way, but their `stepType` *is* in the guard at lines 362-374, so the loop stops on
the next iteration. `INVOKE_AGENT` parks under the `AUTOMATED` step type, which the
guard does not cover — and the `PAUSED` status itself is never inspected.

### Consequences

- **Spurious COMPLETED.** If no step throws, the loop sails through every parked
  agent step to `END` and marks the instance **COMPLETED** — even though no agent
  ever ran or was awaited. The enqueued jobs fire ~1s later, find
  `instance.currentStepId !== payload.stepId` (instance already at `end`), and
  **skip** themselves (`lib/activity-worker-handler.ts:258-263`). This is the
  "configured one agent → whole sub-workflow COMPLETED" data point: configuring the
  last node removed the only failing step, so run-forward reached `END`.
- **FAILED at a later step.** If any step on the run-forward path throws (or a
  downstream step depends on agent output that was never produced), the instance
  fails there — e.g. `set_reserve` in `claims_value_assessment_v1`.

## Root cause #2 (COMPOUNDING): SUB_WORKFLOW invocation is synchronous

`handleSubWorkflowStep` starts the child and runs it **synchronously, in-process,
on the same EntityManager**, then requires a terminal status
(`lib/step-handler.ts:771-841`):

```ts
const result = await executeWorkflow(em, container, childInstance.id, { userId })
if (result.status === 'COMPLETED') { ... }
else if (result.status === 'FAILED') { ... }
else {
  // WAITING, PAUSED, etc. - For synchronous execution, treat as error
  return { status: 'FAILED', error: `Sub-workflow ended in unexpected state: ${result.status}` }
}
```

This is fundamentally incompatible with async-parking agent steps:

- Today (with bug #1 present), the child loop *runs forward* and returns a terminal
  status, so the parent "works" — COMPLETED when all agents are configured, FAILED
  otherwise. But the completion is spurious (no agent actually ran).
- Even if bug #1 is fixed so the child correctly stops at the first agent step, the
  child loop would return `RUNNING`, and this `else` branch would convert it to
  **`FAILED: "Sub-workflow ended in unexpected state: RUNNING"`** — so the
  sub-workflow would fail at the first agent. There is **no parent-side suspend /
  resume-on-child-completion** mechanism.

For sub-workflows containing agents to work, SUB_WORKFLOW must become suspendable:
park the parent step, let the child run/park/resume asynchronously, and resume the
parent on a child-completion signal/event (the parent linkage already exists via
`metadata.labels.parentInstanceId/parentStepId` set at `lib/step-handler.ts:744-749`).

## The "unconfigured agent" (position 11) → fails AT that step

`invokeAgentConfigSchema` requires `agentId: z.string().min(1)`
(`data/validators.ts:123-130`). The visual editor **always emits an `INVOKE_AGENT`
activity for an agent node, even when no agent is selected** — it just sets
`agentId: agent?.agentId || ''` (`lib/nodeFormTransforms.ts:393`). So an
unconfigured node is **not** a no-op:

- At runtime `executeInvokeAgent` validates config **first** and throws
  `INVOKE_AGENT config invalid: agentId: ...` on the empty string
  (`lib/activity-executor.ts:928-934`) → activity `success:false` →
  `handleAutomatedStep` returns FAILED (`lib/step-handler.ts:493-509`) →
  `executeTransition` returns `success:false` (`lib/transition-handler.ts:595`) →
  the executor calls `completeWorkflow('FAILED')` (`lib/workflow-executor.ts:431-452`).
- The instance therefore **fails AT the unconfigured step**, leaving
  `currentStepId` on that step.

This explains `claims_value_assessment_v1` failing with `currentStep = set_reserve`:
**`set_reserve` was the agent node left without an agent** (or whose agent run
threw — the worker's `failInvokeAgentStep` path, `lib/activity-worker-handler.ts:292-302`).
The earlier agent steps in that same run showed `STEP_ENTERED → SIGNAL_AWAITING →
TRANSITION_EXECUTED` because of bug #1 (run-forward): the loop parked each of them
but advanced anyway, never awaiting their agents, until it reached the failing
`set_reserve` step. Configuring that agent removed the only failing step, so
run-forward then reached `END` and the (sub)workflow was marked **COMPLETED** — the
"configure one agent → completed" data point — even though the upstream agents were
parked-and-skipped rather than truly executed.

(Empty `agentId` only escapes validation when a definition is **seeded/imported**
via the unvalidated `lib/seeds.ts:124-131` path; the API save path enforces it via
`activityDefinitionSchema.superRefine`, `data/validators.ts:260-273`. The shipped
claims blueprints all carry concrete agent ids.)

Confirm the exact failure reason by reading the `WORKFLOW_FAILED` / `STEP_FAILED`
event `Details` payload for instance `#f230879b`.

## What the modified files in the working tree do (NOT the fix)

- `lib/graph-utils.ts`, `components/WorkflowTransitionEdge.tsx`,
  `lib/__tests__/graph-layout-positions.test.ts` — **purely visual** (dagre node
  sizing, hover-only edge labels, spacing). No effect on control flow. These are the
  prior "surface-oriented" attempts.
- `lib/activity-worker-handler.ts` (+ `invoke-agent-async.test.ts`) — adds a
  fail-stop when the agent **run** throws (`failInvokeAgentStep`). Useful hardening,
  but it does not address run-forward: by the time the worker runs (1s later), the
  instance has usually already completed/failed and the job is skipped.

## Recommended fixes (for a follow-up change)

1. **Stop the loop on a parked instance (fixes #1).** After `executeTransition`
   returns, or at the top of the loop, treat `currentInstance.status === 'PAUSED'`
   (and `WAITING_FOR_ACTIVITIES`) as a terminal-for-this-pass state and return
   RUNNING, mirroring the `FORKED` early-exit. Equivalently/additionally, make
   `executeTransitionForToken` recognize a `WAITING` result from `executeStep`
   (not just `FAILED`) and surface a "paused" flag the loop honors. This makes pause
   detection key off the **actual paused status**, not the step type, so any parking
   step (INVOKE_AGENT or future types) stops correctly.
2. **Make SUB_WORKFLOW suspendable (fixes #2).** When the child returns a
   non-terminal status, park the parent SUB_WORKFLOW step instead of failing it, and
   resume it via a child-completion signal/event using the existing
   `parentInstanceId/parentStepId` linkage. The synchronous "must be terminal"
   contract at `lib/step-handler.ts:835-840` should no longer treat
   RUNNING/PAUSED as an error.
3. Add regression coverage: an instance with two sequential `INVOKE_AGENT`
   `AUTOMATED` steps must stop at the first (status `PAUSED`, exactly one
   `SIGNAL_AWAITING`, no `TRANSITION_EXECUTED` past it) until a signal arrives; and a
   SUB_WORKFLOW whose child parks must suspend the parent rather than fail.

## Key references

| Concern | Location |
|---|---|
| Main advance loop; no PAUSED guard | `lib/workflow-executor.ts:293-530` |
| Wait-by-stepType guard (misses AUTOMATED+INVOKE_AGENT) | `lib/workflow-executor.ts:362-374` |
| Transition only handles FAILED, not WAITING | `lib/transition-handler.ts:559,595` |
| `pausedForActivities` only for async activities on the transition | `lib/transition-handler.ts:497-548` |
| AUTOMATED step `__park` → `PAUSED` + `SIGNAL_AWAITING` | `lib/step-handler.ts:516-545` |
| Empty-activities AUTOMATED step = instant no-op | `lib/step-handler.ts:441-449` |
| SUB_WORKFLOW synchronous run; non-terminal = FAILED | `lib/step-handler.ts:771-841` |
| `INVOKE_AGENT` enqueue + park (non-blocking) | `lib/activity-executor.ts:923-1036` |
| Fixed signal name | `lib/activity-executor.ts:67` |
| sendSignal resume; requires PAUSED; relaxed agent match | `lib/signal-handler.ts:165-237` |
| Worker runs agent + resume / skip-if-advanced | `lib/activity-worker-handler.ts:241-349` |
| `invokeAgentConfigSchema` requires `agentId` | `data/validators.ts:123-130` |
