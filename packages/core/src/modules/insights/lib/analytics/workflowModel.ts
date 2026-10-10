import { compareCodeUnits } from '../process/registry'
import type { XrayWorkflowDefinitionShape } from '../workflowsBridge'
import { designedModelSchema, type DesignedProcessModel } from './types'

const START_STEP_TYPE = 'START'
const END_STEP_TYPE = 'END'
const ERROR_TRANSITION_KIND = 'error'

/** Model key of a workflow definition (definitions belong to exactly one organization). */
export function workflowModelKey(definitionId: string): string {
  return `workflow:${definitionId.toLowerCase()}`
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCodeUnits)
}

/**
 * The designed model a workflow definition implies for conformance, projected onto the steps
 * the X-Ray activities map to (`activityStepMap`: activity key → step id). Only those steps are
 * observable in the audit history; every other step (automated, control, waiting steps) is
 * passed through: a designed transition X → Y exists when Y is reachable from X through
 * unmapped steps only; start steps are reachable that way from START, end steps reach END that
 * way. Error routes are not part of the designed flow. Map entries pointing at unknown steps
 * are dropped; with no usable entry every step is kept, so the coverage check refuses the
 * comparison instead of the model being invalid. Returns `null` when the definition has no step
 * besides START / END, or when no observable step is reachable from START or reaches END.
 */
export function buildWorkflowConformanceModel(
  definition: XrayWorkflowDefinitionShape,
  activityStepMap: Readonly<Record<string, string>> | null,
): DesignedProcessModel | null {
  const stepTypes = new Map(definition.steps.map((step) => [step.stepId, step.stepType]))
  const inner = definition.steps
    .filter((step) => step.stepType !== START_STEP_TYPE && step.stepType !== END_STEP_TYPE)
    .map((step) => step.stepId)
  if (inner.length === 0) return null
  const innerSet = new Set(inner)
  const usableMap = Object.fromEntries(Object.entries(activityStepMap ?? {})
    .filter(([activityKey, stepId]) => activityKey.length > 0 && innerSet.has(stepId))
    .sort(([left], [right]) => compareCodeUnits(left, right)))
  const mappedSteps = new Set(Object.values(usableMap))
  const observable = mappedSteps.size > 0 ? mappedSteps : innerSet
  const successors = new Map<string, string[]>()
  for (const transition of definition.transitions) {
    if (transition.kind === ERROR_TRANSITION_KIND) continue
    if (!stepTypes.has(transition.fromStepId) || !stepTypes.has(transition.toStepId)) continue
    const next = successors.get(transition.fromStepId) ?? []
    next.push(transition.toStepId)
    successors.set(transition.fromStepId, next)
  }
  const reach = (origin: string): { steps: Set<string>; reachesEnd: boolean } => {
    const steps = new Set<string>()
    let reachesEnd = false
    const visited = new Set<string>([origin])
    const queue = [...(successors.get(origin) ?? [])]
    while (queue.length > 0) {
      const stepId = queue.shift() as string
      if (visited.has(stepId)) {
        if (observable.has(stepId)) steps.add(stepId)
        continue
      }
      visited.add(stepId)
      const stepType = stepTypes.get(stepId)
      if (stepType === END_STEP_TYPE) {
        reachesEnd = true
        continue
      }
      if (stepType === START_STEP_TYPE) continue
      if (observable.has(stepId)) {
        steps.add(stepId)
        continue
      }
      queue.push(...(successors.get(stepId) ?? []))
    }
    return { steps, reachesEnd }
  }
  const startSteps = new Set<string>()
  for (const step of definition.steps) {
    if (step.stepType === START_STEP_TYPE) for (const reached of reach(step.stepId).steps) startSteps.add(reached)
  }
  const transitions: Array<[string, string]> = []
  const endSteps = new Set<string>()
  const steps = sortedUnique(observable)
  for (const stepId of steps) {
    const reached = reach(stepId)
    if (reached.reachesEnd) endSteps.add(stepId)
    for (const target of sortedUnique(reached.steps)) transitions.push([stepId, target])
  }
  const parsed = designedModelSchema.safeParse({
    key: workflowModelKey(definition.id),
    source: { kind: 'workflow', definitionId: definition.id, version: definition.version },
    steps,
    transitions,
    startSteps: sortedUnique(startSteps),
    endSteps: sortedUnique(endSteps),
    activityStepMap: usableMap,
  })
  return parsed.success ? parsed.data : null
}
