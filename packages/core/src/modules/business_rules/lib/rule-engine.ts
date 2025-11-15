import type { EntityManager } from '@mikro-orm/core'
import type { BusinessRule, RuleExecutionLog } from '../data/entities'
import * as ruleEvaluator from './rule-evaluator'
import * as actionExecutor from './action-executor'
import type { RuleEvaluationContext } from './rule-evaluator'
import type { ActionContext, ActionExecutionOutcome } from './action-executor'

/**
 * Rule execution context
 */
export interface RuleEngineContext {
  entityType: string
  entityId?: string
  eventType?: string
  data: any
  user?: {
    id?: string
    email?: string
    role?: string
    [key: string]: any
  }
  tenant?: {
    id?: string
    [key: string]: any
  }
  organization?: {
    id?: string
    [key: string]: any
  }
  tenantId: string
  organizationId: string
  executedBy?: string
  dryRun?: boolean
  [key: string]: any
}

/**
 * Single rule execution result
 */
export interface RuleExecutionResult {
  rule: BusinessRule
  conditionResult: boolean
  actionsExecuted: ActionExecutionOutcome | null
  executionTime: number
  error?: string
}

/**
 * Overall rule engine result
 */
export interface RuleEngineResult {
  allowed: boolean
  executedRules: RuleExecutionResult[]
  totalExecutionTime: number
  errors?: string[]
  logIds?: string[]
}

/**
 * Rule discovery options
 */
export interface RuleDiscoveryOptions {
  entityType: string
  eventType?: string
  tenantId: string
  organizationId: string
  ruleType?: string
}

/**
 * Execute all applicable rules for the given context
 */
export async function executeRules(
  em: EntityManager,
  context: RuleEngineContext
): Promise<RuleEngineResult> {
  const startTime = Date.now()
  const executedRules: RuleExecutionResult[] = []
  const errors: string[] = []
  const logIds: string[] = []

  try {
    // Discover applicable rules
    const rules = await findApplicableRules(em, {
      entityType: context.entityType,
      eventType: context.eventType,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })

    // Sort rules by priority
    const sortedRules = ruleEvaluator.sortRulesByPriority(rules)

    // Execute each rule
    for (const rule of sortedRules) {
      try {
        const ruleResult = await executeSingleRule(em, rule, context)
        executedRules.push(ruleResult)

        if (ruleResult.error) {
          errors.push(`Rule ${rule.ruleId}: ${ruleResult.error}`)
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        errors.push(`Rule ${rule.ruleId}: ${errorMessage}`)

        executedRules.push({
          rule,
          conditionResult: false,
          actionsExecuted: null,
          executionTime: 0,
          error: errorMessage,
        })
      }
    }

    // Determine overall allowed status
    // For GUARD rules: all must pass for operation to be allowed
    const guardRules = executedRules.filter((r) => r.rule.ruleType === 'GUARD')
    const allowed = guardRules.length === 0 || guardRules.every((r) => r.conditionResult)

    const totalExecutionTime = Date.now() - startTime

    return {
      allowed,
      executedRules,
      totalExecutionTime,
      errors: errors.length > 0 ? errors : undefined,
      logIds: logIds.length > 0 ? logIds : undefined,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    errors.push(`Rule engine error: ${errorMessage}`)

    const totalExecutionTime = Date.now() - startTime

    return {
      allowed: false,
      executedRules,
      totalExecutionTime,
      errors,
    }
  }
}

/**
 * Execute a single rule
 */
export async function executeSingleRule(
  em: EntityManager,
  rule: BusinessRule,
  context: RuleEngineContext
): Promise<RuleExecutionResult> {
  const startTime = Date.now()

  try {
    // Build evaluation context
    const evalContext: RuleEvaluationContext = {
      entityType: context.entityType,
      entityId: context.entityId,
      eventType: context.eventType,
      user: context.user,
      tenant: context.tenant,
      organization: context.organization,
    }

    // Evaluate rule conditions
    const result = await ruleEvaluator.evaluateSingleRule(rule, context.data, evalContext)

    if (!result.success) {
      const executionTime = Date.now() - startTime

      // Log failure if not dry run
      if (!context.dryRun) {
        await logRuleExecution(em, {
          rule,
          context,
          conditionResult: false,
          actionsExecuted: null,
          executionTime,
          error: result.error,
        })
      }

      return {
        rule,
        conditionResult: false,
        actionsExecuted: null,
        executionTime,
        error: result.error,
      }
    }

    // Determine which actions to execute based on condition result
    const actions = result.success ? rule.successActions : rule.failureActions

    let actionsExecuted: ActionExecutionOutcome | null = null

    if (actions && Array.isArray(actions) && actions.length > 0) {
      // Build action context
      const actionContext: ActionContext = {
        ...evalContext,
        data: context.data,
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
      }

      // Execute actions
      actionsExecuted = await actionExecutor.executeActions(actions, actionContext)
    }

    const executionTime = Date.now() - startTime

    // Log execution if not dry run
    if (!context.dryRun) {
      await logRuleExecution(em, {
        rule,
        context,
        conditionResult: result.success,
        actionsExecuted,
        executionTime,
      })
    }

    return {
      rule,
      conditionResult: result.success,
      actionsExecuted,
      executionTime,
    }
  } catch (error) {
    const executionTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Log error if not dry run
    if (!context.dryRun) {
      await logRuleExecution(em, {
        rule,
        context,
        conditionResult: false,
        actionsExecuted: null,
        executionTime,
        error: errorMessage,
      })
    }

    return {
      rule,
      conditionResult: false,
      actionsExecuted: null,
      executionTime,
      error: errorMessage,
    }
  }
}

/**
 * Find all applicable rules for the given criteria
 */
export async function findApplicableRules(
  em: EntityManager,
  options: RuleDiscoveryOptions
): Promise<BusinessRule[]> {
  const { entityType, eventType, tenantId, organizationId, ruleType } = options

  const where: any = {
    entityType,
    tenantId,
    organizationId,
    enabled: true,
    deletedAt: null,
  }

  if (eventType) {
    where.eventType = eventType
  }

  if (ruleType) {
    where.ruleType = ruleType
  }

  // Query rules from database
  const rules = (await em.find('BusinessRule' as any, where, {
    orderBy: { priority: 'DESC' as any, ruleId: 'ASC' as any },
  })) as BusinessRule[]

  // Filter by effective date range
  const now = new Date()
  return rules.filter((rule) => {
    if (rule.effectiveFrom && rule.effectiveFrom > now) {
      return false
    }
    if (rule.effectiveTo && rule.effectiveTo < now) {
      return false
    }
    return true
  })
}

/**
 * Log rule execution to database
 */
interface LogExecutionOptions {
  rule: BusinessRule
  context: RuleEngineContext
  conditionResult: boolean
  actionsExecuted: ActionExecutionOutcome | null
  executionTime: number
  error?: string
}

export async function logRuleExecution(
  em: EntityManager,
  options: LogExecutionOptions
): Promise<string> {
  const { rule, context, conditionResult, actionsExecuted, executionTime, error } = options

  const executionResult: 'SUCCESS' | 'FAILURE' | 'ERROR' = error
    ? 'ERROR'
    : conditionResult
      ? 'SUCCESS'
      : 'FAILURE'

  const log = em.create('RuleExecutionLog' as any, {
    rule,
    entityId: context.entityId || 'unknown',
    entityType: context.entityType,
    executionResult,
    inputContext: {
      data: context.data,
      eventType: context.eventType,
      user: context.user,
    },
    outputContext: actionsExecuted
      ? {
          conditionResult,
          actionsExecuted: actionsExecuted.results.map((r) => ({
            type: r.action.type,
            success: r.success,
            error: r.error,
          })),
        }
      : null,
    errorMessage: error || null,
    executionTimeMs: executionTime,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    executedBy: context.executedBy || null,
  })

  await em.persistAndFlush(log)

  return (log as RuleExecutionLog).id
}
