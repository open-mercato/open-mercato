/**
 * Rerun from step (spec §8.4) — the eligibility decision, PURE.
 *
 * > "**Rerun from failed step**, optionally with edited context — audited as
 * > `STEP_RERUN { editedContextDiff, by }`, gated by its own ACL feature."
 *
 * **This does NOT change the step state machine.** `workflows/AGENTS.md` says a
 * step goes `PENDING → ACTIVE → COMPLETED|FAILED|SKIPPED|CANCELLED` and is
 * never set out of order, so reviving the terminal `StepInstance` is out of the
 * question. It never happens here: the terminal row is read for its recorded
 * `stepType` and then left exactly as it is, and the new attempt gets a FRESH
 * row — which is what the engine already does on every step entry
 * (`lib/step-handler.ts` `enterStep` unconditionally
 * `em.create(StepInstance, { … status: 'ACTIVE' … })`). Both attempts stay in
 * the audit trail, and no status transition is invented.
 *
 * The cursor move plus `executeStep` is the same shape the definition-level
 * error handler already uses (`enterErrorHandlerStep` in
 * `lib/workflow-executor.ts`), so no transition record is invented either.
 */

/** Step-instance statuses that mean the attempt is over and a new one is safe. */
const TERMINAL_STEP_STATUSES = new Set(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED'])

/**
 * Instance statuses a rerun may act on. A RUNNING instance is excluded on
 * purpose: the engine is mid-advance and moving its cursor underneath it would
 * race the execution loop.
 */
const RERUNNABLE_INSTANCE_STATUSES = new Set(['FAILED', 'PAUSED'])

export type RerunRefusalCode =
  | 'WORKFLOW_INSTANCE_NOT_RERUNNABLE'
  | 'WORKFLOW_STEP_NOT_IN_DEFINITION'
  | 'WORKFLOW_STEP_TYPE_CHANGED'
  | 'WORKFLOW_STEP_NEVER_EXECUTED'
  | 'WORKFLOW_STEP_STILL_PARKED'

export type RerunStepExecutionInput = {
  id: string
  stepId: string
  stepType: string
  status: string
  enteredAt?: string | Date | null
  createdAt?: string | Date | null
}

export type RerunEligibility =
  | { ok: true; supersededStepInstanceId: string; stepType: string }
  | { ok: false; code: RerunRefusalCode; message: string }

function orderKey(execution: RerunStepExecutionInput): number {
  const raw = execution.enteredAt ?? execution.createdAt
  if (!raw) return 0
  const parsed = raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function resolveRerunEligibility(input: {
  instanceStatus: string
  stepId: string
  definitionSteps: ReadonlyArray<{ stepId: string; stepType: string }>
  stepExecutions: ReadonlyArray<RerunStepExecutionInput>
}): RerunEligibility {
  if (!RERUNNABLE_INSTANCE_STATUSES.has(input.instanceStatus)) {
    return {
      ok: false,
      code: 'WORKFLOW_INSTANCE_NOT_RERUNNABLE',
      message: `Cannot rerun a step of a ${input.instanceStatus} instance. Only FAILED or PAUSED instances can be rerun.`,
    }
  }

  const definitionStep = input.definitionSteps.find((step) => step.stepId === input.stepId)
  if (!definitionStep) {
    return {
      ok: false,
      code: 'WORKFLOW_STEP_NOT_IN_DEFINITION',
      message: `Step ${input.stepId} is no longer part of this workflow definition.`,
    }
  }

  const executions = input.stepExecutions.filter((execution) => execution.stepId === input.stepId)
  if (executions.length === 0) {
    return {
      ok: false,
      code: 'WORKFLOW_STEP_NEVER_EXECUTED',
      message: `Step ${input.stepId} has not executed in this run, so there is nothing to rerun.`,
    }
  }

  const latest = [...executions].sort((left, right) => orderKey(right) - orderKey(left))[0]

  if (!TERMINAL_STEP_STATUSES.has(latest.status)) {
    // The step is still parked: a queue job and, for an agent step, a pending
    // proposal are still addressed to THIS attempt. Rerunning would leave both
    // orphaned and able to resume the run a second time. Lifting this needs
    // §7.4's addressable resume token.
    return {
      ok: false,
      code: 'WORKFLOW_STEP_STILL_PARKED',
      message: `Step ${input.stepId} is still ${latest.status}. Cancel or resolve the pending attempt before rerunning it.`,
    }
  }

  if (latest.stepType !== definitionStep.stepType) {
    // The instance pins `definitionId` and the engine re-reads that row, so a
    // FAILED instance's definition can be edited in place — the structural-edit
    // guard only refuses while instances are ACTIVE. Replaying a step whose
    // type changed underneath would execute something the run never ran.
    return {
      ok: false,
      code: 'WORKFLOW_STEP_TYPE_CHANGED',
      message: `Step ${input.stepId} changed from ${latest.stepType} to ${definitionStep.stepType} since this run started. Start a new instance instead.`,
    }
  }

  return { ok: true, supersededStepInstanceId: latest.id, stepType: latest.stepType }
}

export type ContextDiffEntry = { from: unknown; to: unknown }

/**
 * The `editedContextDiff` the `STEP_RERUN` event records. Only the keys the
 * caller actually changed appear — a patch that re-sends an identical value is
 * not an edit, and recording it would make the audit unreadable.
 */
export function computeContextDiff(
  before: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined
): Record<string, ContextDiffEntry> {
  const diff: Record<string, ContextDiffEntry> = {}
  if (!patch) return diff
  const source = before ?? {}
  for (const [key, next] of Object.entries(patch)) {
    const current = source[key]
    if (JSON.stringify(current) === JSON.stringify(next)) continue
    diff[key] = { from: current ?? null, to: next }
  }
  return diff
}
