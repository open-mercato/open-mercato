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
  kind?: unknown
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

function forEachBranchingStep(
  definition: { steps?: unknown; transitions?: unknown },
  visit: (context: {
    stepIndex: number
    stepId: string
    stepType: BranchingStepType
    outgoing: TransitionLike[]
  }) => void,
): void {
  const steps = Array.isArray(definition?.steps) ? definition.steps : []
  const transitions = Array.isArray(definition?.transitions) ? definition.transitions : []

  steps.forEach((step, stepIndex) => {
    const { stepId, stepType } = (step && typeof step === 'object' ? step : {}) as StepLike
    if (typeof stepId !== 'string' || !isBranchingStepType(stepType)) return

    // An error route is only reachable from a failure, so it is neither a case
    // route nor the otherwise route — counting it as one would silence the
    // missing-otherwise warning on a branching step that really can stall.
    const outgoing = transitions.filter((transition) => {
      const from = (transition && typeof transition === 'object' ? transition : {}) as TransitionLike
      return from.fromStepId === stepId && from.kind !== 'error'
    }) as TransitionLike[]

    visit({ stepIndex, stepId, stepType, outgoing })
  })
}

export function collectBranchingRouteWarnings(definition: {
  steps?: unknown
  transitions?: unknown
}): BranchingRouteWarning[] {
  const warnings: BranchingRouteWarning[] = []

  forEachBranchingStep(definition, ({ stepIndex, stepId, stepType, outgoing }) => {
    if (outgoing.length === 0) return
    if (outgoing.some((transition) => !hasCondition(transition))) return
    warnings.push({ path: ['steps', stepIndex], stepId, stepType })
  })

  return warnings
}

export interface DuplicateBranchingCaseWarning extends BranchingRouteWarning {
  caseValue: string
}

function readCaseValue(condition: unknown): string | null {
  if (!condition || typeof condition !== 'object') return null
  const group = condition as { rules?: unknown }
  const rules = Array.isArray(group.rules) ? group.rules : []
  const [firstRule] = rules
  if (!firstRule || typeof firstRule !== 'object') return null
  const simple = firstRule as { field?: unknown; value?: unknown }
  if (typeof simple.field !== 'string' || simple.value === undefined || simple.value === null) return null
  return `${simple.field}=${String(simple.value)}`
}

/**
 * Duplicate Switch case values: two routes that test the same field for the
 * same value make the lower-priority one unreachable.
 */
export function collectDuplicateBranchingCaseWarnings(definition: {
  steps?: unknown
  transitions?: unknown
}): DuplicateBranchingCaseWarning[] {
  const warnings: DuplicateBranchingCaseWarning[] = []

  forEachBranchingStep(definition, ({ stepIndex, stepId, stepType, outgoing }) => {
    const seen = new Set<string>()
    const reported = new Set<string>()
    for (const transition of outgoing) {
      const caseValue = readCaseValue(transition.condition)
      if (!caseValue) continue
      if (seen.has(caseValue) && !reported.has(caseValue)) {
        reported.add(caseValue)
        warnings.push({ path: ['steps', stepIndex], stepId, stepType, caseValue })
      }
      seen.add(caseValue)
    }
  })

  return warnings
}
