/**
 * Workflows Module — Run Outcome (pure)
 *
 * The run's **verdict**, alongside — never instead of — its lifecycle `status`.
 *
 * `status` answers *did it reach the end?* and drives control flow (is this run
 * active? may the executor advance it? can it be retried?). It is untouched by
 * this module. `outcome` answers the other question the same enum used to be
 * asked to answer on its own: *did everything it attempted actually happen?*
 * Conflating the two is why a run that swallowed three failed writes reported
 * the same `COMPLETED` as a clean one.
 *
 * | outcome                 | meaning                                                       |
 * |-------------------------|---------------------------------------------------------------|
 * | `success`               | Reached END. Nothing failed, nothing was suppressed.           |
 * | `success_with_warnings` | Reached END and did everything asked, but something is worth reading. |
 * | `partial_failure`       | Reached END, but at least one activity or step failed and was tolerated. |
 * | `failure`               | Did not reach END.                                             |
 * | `cancelled`             | A human stopped it.                                            |
 * | `compensated`           | Rolled back.                                                   |
 *
 * **The invariant this module exists for:**
 *
 * > A run that suppressed at least one failure MUST NOT be `success`.
 *
 * It holds by construction — `resolveRunOutcome` consults
 * `failureEvidenceCount` before it can ever return `success`, and it is the ONE
 * decision point, so no exit point can assemble a friendlier verdict of its own.
 *
 * PURE: no ORM, DI, React or registry imports, exactly like `lib/error-routing.ts`,
 * `lib/breach-routing.ts` and `lib/outcome-routing.ts`. The impure half —
 * counting the recorded evidence — lives in `lib/run-outcome-evidence.ts`.
 */

export const WORKFLOW_RUN_OUTCOMES = [
  'success',
  'success_with_warnings',
  'partial_failure',
  'failure',
  'cancelled',
  'compensated',
] as const

export type WorkflowRunOutcome = (typeof WORKFLOW_RUN_OUTCOMES)[number]

/**
 * `StepInstance.status` values that ARE recorded failure evidence.
 *
 * A step row only becomes FAILED through `markStepInstanceFailed`, which the
 * enabling fix made unconditional — a tolerated failure is recorded exactly like
 * a fatal one, because tolerating a failure is a routing decision, not a reason
 * to forget it happened.
 */
export const RUN_OUTCOME_FAILED_STEP_STATUS = 'FAILED'

/** `StepInstance.status` value that is a warning rather than a failure. */
export const RUN_OUTCOME_SKIPPED_STEP_STATUS = 'SKIPPED'

/**
 * Event types that are failure evidence a step row does NOT already carry.
 *
 * `ACTIVITY_FAILED` is the one that matters: a transition's activities run
 * LEAVING their source step, whose row has already exited COMPLETED, so a
 * transition-level `continueOnActivityFailure` (the shipped `order-approval`
 * shape) leaves no failed step row anywhere — only this event. `STEP_FAILED` is
 * deliberately absent: it is one-to-one with a FAILED row and counting both
 * would double-count the same failure.
 */
export const RUN_OUTCOME_FAILURE_EVENT_TYPES = ['ACTIVITY_FAILED'] as const

/** Event types that are warning evidence a step row does not already carry. */
export const RUN_OUTCOME_WARNING_EVENT_TYPES = ['STEP_SKIPPED'] as const

/**
 * What the run recorded about itself, already counted.
 *
 * Counts rather than rows because the decision is a `> 0` test and the collector
 * answers it with `COUNT(*)`; the numbers are evidence for the verdict, not a
 * reported metric.
 *
 * **Known imprecision, deliberately not papered over:** a run that failed, was
 * retried and then completed still carries its pre-retry `ACTIVITY_FAILED`
 * rows, so it reports `partial_failure`. The engine records no attempt boundary
 * to subtract them by, and over-reporting a degraded run is the safe direction
 * for a change whose whole purpose is to stop under-reporting one.
 */
export type RunOutcomeEvidence = {
  /** The status the run is terminating with. */
  terminalStatus: string
  /** FAILED step rows plus `ACTIVITY_FAILED` events. */
  failureEvidenceCount: number
  /** SKIPPED step rows plus `STEP_SKIPPED` events. */
  warningEvidenceCount: number
}

export const EMPTY_RUN_OUTCOME_EVIDENCE: Omit<RunOutcomeEvidence, 'terminalStatus'> = {
  failureEvidenceCount: 0,
  warningEvidenceCount: 0,
}

/**
 * The single decision point. Terminal status first, because `cancelled`,
 * `compensated` and `failure` are facts about the lifecycle that no amount of
 * evidence can argue with; only a run that actually reached END is judged on
 * what it recorded.
 */
export function resolveRunOutcome(evidence: RunOutcomeEvidence): WorkflowRunOutcome {
  if (evidence.terminalStatus === 'CANCELLED') return 'cancelled'
  if (evidence.terminalStatus === 'COMPENSATED') return 'compensated'
  if (evidence.terminalStatus !== 'COMPLETED') return 'failure'
  if (evidence.failureEvidenceCount > 0) return 'partial_failure'
  if (evidence.warningEvidenceCount > 0) return 'success_with_warnings'
  return 'success'
}

/** True for a verdict an operator must look at even though the run reached END. */
export function isDegradedRunOutcome(outcome: WorkflowRunOutcome | null | undefined): boolean {
  return outcome === 'partial_failure'
}

/**
 * Outcomes the needs-attention / failure queue must include.
 *
 * A `partial_failure` is precisely the run nobody looks at because it said
 * COMPLETED — which is the failure this whole change exists to remove.
 */
export const WORKFLOW_ATTENTION_OUTCOMES = ['partial_failure'] as const

/**
 * `partial_failure` is NOT retryable as a whole run (maintainer decision,
 * 2026-07-30). It reached END, so replaying the graph would re-run every part
 * that already succeeded — duplicating their effects to re-attempt the parts
 * that did not. Recovery is rerun-from-step on the specific failed step, which
 * is what that feature is for and what the enabling fix unblocked.
 */
export function isRetryableRunOutcome(outcome: WorkflowRunOutcome | null | undefined): boolean {
  return outcome === 'failure'
}

export function isWorkflowRunOutcome(value: unknown): value is WorkflowRunOutcome {
  return typeof value === 'string' && (WORKFLOW_RUN_OUTCOMES as readonly string[]).includes(value)
}
