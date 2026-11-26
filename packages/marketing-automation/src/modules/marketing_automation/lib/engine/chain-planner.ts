import type { CampaignStep } from './types.js'

export const WAIT_STEP_TYPE = 'wait'

/**
 * What the executor should do at one position in the step list.
 *
 * `pause` carries `resumeIndex` — the step to continue from once the wait elapses. That is
 * the index AFTER the wait step, because the wait itself is the pause and is not re-executed
 * on resume. Modelling the delay as its own step is what removes the awkward "run the first
 * step unconditionally on resume" rule the Magento original needed, where the delay was an
 * attribute of the action it preceded.
 */
export type PlannedStep =
  | { kind: 'run'; index: number; step: CampaignStep }
  | { kind: 'pause'; index: number; resumeIndex: number; minutes: number }

/** A wait of zero or less is a no-op rather than a park — it would otherwise cost a round trip. */
function readWaitMinutes(step: CampaignStep): number {
  const raw = step.params?.minutes
  const minutes = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(minutes) ? minutes : 0
}

/**
 * Plans a walk over the step list, with no I/O.
 *
 * Pure so the sequencing rules are exhaustively testable: the plan stops at the first real
 * wait, and everything after it is deliberately absent — a wait parks the whole remainder of
 * the journey, not just its own position.
 *
 * An unknown step type is still planned as `run`; whether an unregistered type is skipped or
 * fails is the executor's policy, not the planner's.
 */
export function planSteps(steps: CampaignStep[], startIndex = 0): PlannedStep[] {
  const plan: PlannedStep[] = []

  for (let index = Math.max(0, startIndex); index < steps.length; index += 1) {
    const step = steps[index]
    if (!step) continue

    if (step.type === WAIT_STEP_TYPE) {
      const minutes = readWaitMinutes(step)
      if (minutes > 0) {
        plan.push({ kind: 'pause', index, resumeIndex: index + 1, minutes })
        return plan
      }
      continue
    }

    plan.push({ kind: 'run', index, step })
  }

  return plan
}
