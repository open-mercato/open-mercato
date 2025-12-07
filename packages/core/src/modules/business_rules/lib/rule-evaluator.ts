import type { BusinessRule } from '../data/entities'
import { evaluateExpression, type EvaluationContext, type ConditionExpression } from './expression-evaluator'

/**
 * Rule evaluation context
 */
export interface RuleEvaluationContext extends EvaluationContext {
  entityType?: string
  entityId?: string
  eventType?: string
  [key: string]: any
}

/**
 * Rule evaluation result (for evaluating multiple rules)
 */
export interface RuleEvaluationResult {
  conditionsPassed: boolean        // At least one rule matched
  evaluationCompleted: boolean     // All rules evaluated without critical errors
  matchedRules: BusinessRule[]
  failedRules: BusinessRule[]
  evaluationTime: number
  errors?: string[]
}

/**
 * Single rule evaluation result
 */
export interface SingleRuleResult {
  rule: BusinessRule
  conditionsPassed: boolean     // Logical result: did conditions evaluate to true?
  evaluationCompleted: boolean  // Technical success: did evaluation finish without errors?
  evaluationTime: number
  error?: string
}

/**
 * Evaluate multiple rules and return aggregated results
 */
export async function evaluate(
  rules: BusinessRule[],
  data: any,
  context: RuleEvaluationContext
): Promise<RuleEvaluationResult> {
  const startTime = Date.now()
  const matchedRules: BusinessRule[] = []
  const failedRules: BusinessRule[] = []
  const errors: string[] = []
  let anyEvaluationCompleted = false

  // Sort rules by priority (higher priority first)
  const sortedRules = sortRulesByPriority(rules)

  // Evaluate each rule
  for (const rule of sortedRules) {
    try {
      const result = await evaluateSingleRule(rule, data, context)

      // Track if any rule completed evaluation
      if (result.evaluationCompleted) {
        anyEvaluationCompleted = true
      }

      if (result.evaluationCompleted && result.conditionsPassed) {
        matchedRules.push(rule)
      } else {
        failedRules.push(rule)
      }

      if (result.error) {
        errors.push(`Rule ${rule.ruleId}: ${result.error}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push(`Rule ${rule.ruleId}: ${errorMessage}`)
      failedRules.push(rule)
    }
  }

  const evaluationTime = Date.now() - startTime

  // Determine if conditions were met (at least one rule matched)
  const conditionsPassed = matchedRules.length > 0

  return {
    conditionsPassed,
    evaluationCompleted: anyEvaluationCompleted,
    matchedRules,
    failedRules,
    evaluationTime,
    errors: errors.length > 0 ? errors : undefined,
  }
}

/**
 * Evaluate a single business rule
 */
export async function evaluateSingleRule(
  rule: BusinessRule,
  data: any,
  context: RuleEvaluationContext
): Promise<SingleRuleResult> {
  const startTime = Date.now()

  try {
    // Check if rule is enabled
    if (!rule.enabled) {
      return {
        rule,
        conditionsPassed: false,
        evaluationCompleted: false,
        evaluationTime: 0,
        error: 'Rule is disabled',
      }
    }

    // Check effective date range
    if (!isRuleEffective(rule)) {
      return {
        rule,
        conditionsPassed: false,
        evaluationCompleted: false,
        evaluationTime: 0,
        error: 'Rule is not effective (outside date range)',
      }
    }

    // Evaluate conditions
    const conditionsPassed = await evaluateConditions(rule.conditionExpression, data, context)

    const evaluationTime = Date.now() - startTime

    return {
      rule,
      conditionsPassed,
      evaluationCompleted: true,
      evaluationTime,
    }
  } catch (error) {
    const evaluationTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      rule,
      conditionsPassed: false,
      evaluationCompleted: false,
      evaluationTime,
      error: errorMessage,
    }
  }
}

/**
 * Evaluate rule conditions (delegates to expression evaluator)
 */
export async function evaluateConditions(
  conditions: any,
  data: any,
  context: RuleEvaluationContext
): Promise<boolean> {
  if (!conditions) {
    return true
  }

  try {
    const expression = conditions as ConditionExpression
    return evaluateExpression(expression, data, context)
  } catch (error) {
    // If evaluation fails, the rule fails
    throw new Error(`Condition evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Sort rules by priority (higher priority first, then by ID for stability)
 */
export function sortRulesByPriority(rules: BusinessRule[]): BusinessRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority
    }

    // If priority is the same, sort by ruleId for stability
    return a.ruleId.localeCompare(b.ruleId)
  })
}

/**
 * Check if rule is within its effective date range
 */
function isRuleEffective(rule: BusinessRule): boolean {
  const now = new Date()

  // Check effectiveFrom
  if (rule.effectiveFrom && rule.effectiveFrom > now) {
    return false
  }

  // Check effectiveTo
  if (rule.effectiveTo && rule.effectiveTo < now) {
    return false
  }

  return true
}

/**
 * Filter rules by entity type and event type
 */
export function filterRulesByContext(
  rules: BusinessRule[],
  entityType?: string,
  eventType?: string
): BusinessRule[] {
  return rules.filter((rule) => {
    // Filter by entity type
    if (entityType && rule.entityType !== entityType) {
      return false
    }

    // Filter by event type (if rule specifies one)
    if (eventType && rule.eventType && rule.eventType !== eventType) {
      return false
    }

    return true
  })
}

/**
 * Get applicable rules for a context (filtered, sorted, and enabled)
 */
export function getApplicableRules(
  rules: BusinessRule[],
  entityType?: string,
  eventType?: string
): BusinessRule[] {
  // Filter by context
  const filtered = filterRulesByContext(rules, entityType, eventType)

  // Filter by enabled status
  const enabled = filtered.filter((rule) => rule.enabled)

  // Filter by effective date
  const effective = enabled.filter((rule) => isRuleEffective(rule))

  // Sort by priority
  return sortRulesByPriority(effective)
}
