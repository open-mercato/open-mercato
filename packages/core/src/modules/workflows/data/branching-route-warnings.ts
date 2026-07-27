/**
 * Advisory branching-route validation (spec
 * 2026-07-26-workflows-ux-redesign.md section 4.4): a branching node whose
 * outgoing routes are all conditioned can strand an instance when no condition
 * matches, so the editor warns when no unconditioned "otherwise" route exists.
 *
 * This is a WARNING channel only — never a schema error — because IF_ELSE and
 * SWITCH are pure transition sugar and a definition without an otherwise route
 * is still structurally valid and must stay saveable.
 */

export const BRANCHING_STEP_TYPES = ['IF_ELSE', 'SWITCH'] as const

export type BranchingStepType = (typeof BRANCHING_STEP_TYPES)[number]

export interface BranchingRouteWarning {
  path: Array<string | number>
  stepId: string
  stepType: BranchingStepType
}

interface StepLike {
  stepId?: unknown
  stepType?: unknown
}

interface TransitionLike {
  fromStepId?: unknown
  condition?: unknown
  preConditions?: unknown
  postConditions?: unknown
}

function isBranchingStepType(value: unknown): value is BranchingStepType {
  return typeof value === 'string' && (BRANCHING_STEP_TYPES as readonly string[]).includes(value)
}

function hasCondition(transition: TransitionLike): boolean {
  if (transition.condition !== undefined && transition.condition !== null) return true
  if (Array.isArray(transition.preConditions) && transition.preConditions.length > 0) return true
  if (Array.isArray(transition.postConditions) && transition.postConditions.length > 0) return true
  return false
}

export function collectBranchingRouteWarnings(definition: {
  steps?: unknown
  transitions?: unknown
}): BranchingRouteWarning[] {
  const steps = Array.isArray(definition?.steps) ? definition.steps : []
  const transitions = Array.isArray(definition?.transitions) ? definition.transitions : []
  const warnings: BranchingRouteWarning[] = []

  steps.forEach((step, stepIndex) => {
    const { stepId, stepType } = (step && typeof step === 'object' ? step : {}) as StepLike
    if (typeof stepId !== 'string' || !isBranchingStepType(stepType)) return

    const outgoing = transitions.filter((transition) => {
      const from = (transition && typeof transition === 'object' ? transition : {}) as TransitionLike
      return from.fromStepId === stepId
    }) as TransitionLike[]

    if (outgoing.length === 0) return
    if (outgoing.some((transition) => !hasCondition(transition))) return

    warnings.push({ path: ['steps', stepIndex], stepId, stepType })
  })

  return warnings
}
