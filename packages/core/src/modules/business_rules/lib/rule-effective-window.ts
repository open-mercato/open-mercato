import type { BusinessRule } from '../data/entities'

/**
 * Whether a rule's effective window contains `at` (both bounds inclusive, missing bounds open).
 * `at` defaults to the current time, which is the production behaviour; simulations pass the
 * historical instant they replay.
 *
 * Kept in its own module so `rule-engine` uses the real check even where tests auto-mock
 * `rule-evaluator` (which re-exports it).
 */
export function isRuleEffective(
  rule: Pick<BusinessRule, 'effectiveFrom' | 'effectiveTo'>,
  at?: Date,
): boolean {
  const instant = at ?? new Date()

  if (rule.effectiveFrom && rule.effectiveFrom > instant) {
    return false
  }

  if (rule.effectiveTo && rule.effectiveTo < instant) {
    return false
  }

  return true
}
