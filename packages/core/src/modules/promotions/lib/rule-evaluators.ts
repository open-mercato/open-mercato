import type { EvaluationContext, NormalizedRuleGroup } from './types'

// Intentional placeholder for Step 2.2 — the real AND/OR composition over `group.rules`
// plus recursion into `group.children`, dispatching on each `NormalizedRule.type`, ships
// there with its own spec read and its own tests. Do not flesh this out in Step 2.1.
export function evaluateGroup(group: NormalizedRuleGroup, context: EvaluationContext): boolean {
  throw new Error('[internal] evaluateGroup not implemented until Step 2.2')
}
