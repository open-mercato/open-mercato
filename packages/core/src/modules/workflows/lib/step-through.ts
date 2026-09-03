/**
 * Workflows Module — Step-through (spec section 8.2)
 *
 * *"Pause at each step on test runs — inspect context, continue/abort, canvas
 * highlights the active node."*
 *
 * Deliberately implemented as an INSTANCE-level `PAUSED` between steps, using
 * the existing status and an engine-owned metadata marker — the same shape the
 * `failureQueue` directive already uses. It introduces NO new instance status
 * and NO new step status, so the workflow and step state machines are untouched
 * (`AGENTS.md` Ask-First).
 *
 * The marker is a RELEASE TOKEN, not a "paused" boolean: the author releases one
 * named step, the engine runs exactly that step, and the cursor landing anywhere
 * else pauses again. That makes the decision idempotent — replaying
 * `executeWorkflow` after a crash cannot run a step the author never released,
 * and a double-click on Continue cannot run two steps.
 *
 * PURE: no ORM, no DI, no React.
 */

export type WorkflowInstanceStepThrough = {
  enabled: true
  /**
   * The one step the author has authorised to run. `null`/absent means the
   * engine is parked before the current step and waiting for a Continue.
   */
  releaseStepId?: string | null
}

type StepThroughAwareInstance = {
  metadata?: { stepThrough?: WorkflowInstanceStepThrough | null } | null
  currentStepId?: string | null
}

export function isStepThroughArmed(instance: StepThroughAwareInstance | null | undefined): boolean {
  return instance?.metadata?.stepThrough?.enabled === true
}

/**
 * Should the engine stop before executing `stepId`?
 *
 * END is deliberately exempt: it executes nothing, and holding a run one click
 * short of COMPLETED would leave every finished step-through looking parked.
 */
export function shouldPauseForStepThrough(
  instance: StepThroughAwareInstance | null | undefined,
  stepId: string | null | undefined,
  stepType: string | null | undefined,
): boolean {
  if (!isStepThroughArmed(instance)) return false
  if (stepType === 'END') return false
  if (!stepId) return false
  return instance?.metadata?.stepThrough?.releaseStepId !== stepId
}

/**
 * Consume the release token once the released step has been entered, so the
 * NEXT step pauses again. Returns the marker to persist.
 */
export function consumeStepThroughRelease(): WorkflowInstanceStepThrough {
  return { enabled: true, releaseStepId: null }
}

/** Authorise exactly `stepId` to run. */
export function releaseStepThrough(stepId: string): WorkflowInstanceStepThrough {
  return { enabled: true, releaseStepId: stepId }
}

export const STEP_THROUGH_EVENT_TYPE = 'STEP_THROUGH_PAUSED'
export const STEP_THROUGH_RELEASED_EVENT_TYPE = 'STEP_THROUGH_RELEASED'
