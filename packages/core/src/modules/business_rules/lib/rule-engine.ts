import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import { BusinessRule, RuleExecutionLog, type RuleType } from '../data/entities'
import * as ruleEvaluator from './rule-evaluator'
import * as actionExecutor from './action-executor'
import type { RuleEvaluationContext } from './rule-evaluator'
import type { ActionContext, ActionExecutionOutcome } from './action-executor'
import { ruleEngineContextSchema, ruleDiscoveryOptionsSchema, directRuleExecutionContextSchema, ruleIdExecutionContextSchema } from '../data/validators'

/**
 * Constants
 */
const DEFAULT_ENTITY_ID = 'unknown'
const RULE_TYPE_GUARD = 'GUARD'
const EXECUTION_RESULT_ERROR = 'ERROR'
const EXECUTION_RESULT_SUCCESS = 'SUCCESS'
const EXECUTION_RESULT_FAILURE = 'FAILURE'

/**
 * Execution limits
 */
const MAX_RULES_PER_EXECUTION = 100
const MAX_SINGLE_RULE_TIMEOUT_MS = 30000  // 30 seconds
const MAX_TOTAL_EXECUTION_TIMEOUT_MS = 60000  // 60 seconds

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
  logId?: string  // Database log ID (if logged)
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
  ruleType?: RuleType
}

export type RuleEngineExecutionOptions = {
  eventBus?: Pick<EventBus, 'emitEvent'> | null
}

type RuleExecutionFailedPayload = {
  ruleId: string
  ruleName: string
  entityType?: string | null
  errorMessage?: string | null
  tenantId: string
  organizationId?: string | null
}

/**
 * Direct rule execution context (for executing a specific rule by ID)
 */
export interface DirectRuleExecutionContext {
  ruleId: string  // Database UUID of the rule
  data: any
  user?: {
    id?: string
    email?: string
    role?: string
    [key: string]: any
  }
  tenantId: string
  organizationId: string
  executedBy?: string
  dryRun?: boolean
  // Optional for logging (falls back to rule's entityType)
  entityType?: string
  entityId?: string
  eventType?: string
}

/**
 * Direct rule execution result
 */
export interface DirectRuleExecutionResult {
  success: boolean
  ruleId: string
  ruleName: string
  conditionResult: boolean
  actionsExecuted: ActionExecutionOutcome | null
  executionTime: number
  error?: string
  logId?: string
}

/**
 * Context for executing a rule by its string rule_id identifier
 * Unlike DirectRuleExecutionContext which uses database UUID,
 * this uses the string identifier (e.g., "workflow_checkout_inventory_available")
 */
export interface RuleIdExecutionContext {
  ruleId: string  // String identifier (e.g., "workflow_checkout_inventory_available")
  data: any
  user?: {
    id?: string
    email?: string
    role?: string
    [key: string]: any
  }
  tenantId: string
  organizationId: string
  executedBy?: string
  dryRun?: boolean
  entityType?: string
  entityId?: string
  eventType?: string
}

/**
 * Execute a function with a timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} (timeout: ${timeoutMs}ms)`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

/**
 * Execute all applicable rules for the given context
 */
export async function executeRules(
  em: EntityManager,
  context: RuleEngineContext,
  options: RuleEngineExecutionOptions = {}
): Promise<RuleEngineResult> {
  // Validate input
  const validation = ruleEngineContextSchema.safeParse(context)
  if (!validation.success) {
    const validationErrors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return {
      allowed: false,
      executedRules: [],
      totalExecutionTime: 0,
      errors: validationErrors,
    }
  }

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

    // Check rule count limit
    if (rules.length > MAX_RULES_PER_EXECUTION) {
      errors.push(
        `Rule count limit exceeded: ${rules.length} rules found, maximum is ${MAX_RULES_PER_EXECUTION}`
      )
      return {
        allowed: false,
        executedRules: [],
        totalExecutionTime: Date.now() - startTime,
        errors,
      }
    }

    // Rules already sorted by database query (priority DESC, ruleId ASC)
    // Execute each rule with total timeout
    const executionPromise = (async () => {
      for (const rule of rules) {
      try {
        const ruleResult = await executeSingleRule(em, rule, context, options)
        executedRules.push(ruleResult)

        if (ruleResult.logId) {
          logIds.push(ruleResult.logId)
        }

        if (ruleResult.error) {
          errors.push(
            `Rule execution failed [ruleId=${rule.ruleId}, type=${rule.ruleType}, entityType=${context.entityType}]: ${ruleResult.error}`
          )
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        errors.push(
          `Unexpected error in rule execution [ruleId=${rule.ruleId}, type=${rule.ruleType}]: ${errorMessage}`
        )

        if (!context.dryRun) {
          await emitRuleExecutionFailed(options.eventBus, {
            ruleId: rule.ruleId,
            ruleName: rule.ruleName,
            entityType: context.entityType ?? null,
            errorMessage,
            tenantId: context.tenantId,
            organizationId: context.organizationId ?? null,
          })
        }

        executedRules.push({
          rule,
          conditionResult: false,
          actionsExecuted: null,
          executionTime: 0,
          error: errorMessage,
        })
      }
      }
    })()

    // Execute with timeout
    await withTimeout(
      executionPromise,
      MAX_TOTAL_EXECUTION_TIMEOUT_MS,
      `Total rule execution timeout [entityType=${context.entityType}]`
    )

    // Determine overall allowed status
    // For GUARD rules: all must pass for operation to be allowed
    const guardRules = executedRules.filter((r) => r.rule.ruleType === RULE_TYPE_GUARD)
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
    const stack = error instanceof Error ? error.stack : undefined
    errors.push(
      `Critical rule engine error [entityType=${context.entityType}, entityId=${context.entityId || 'unknown'}]: ${errorMessage}${stack ? `\nStack: ${stack}` : ''}`
    )

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
  context: RuleEngineContext,
  options: RuleEngineExecutionOptions = {}
): Promise<RuleExecutionResult> {
  const startTime = Date.now()

  try {
    // Wrap execution in timeout
    const executeWithTimeout = async () => {
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

      // Check if evaluation completed (not just if conditions passed)
      if (!result.evaluationCompleted) {
        const executionTime = Date.now() - startTime

        let logId: string | undefined

        // Log failure if not dry run
        if (!context.dryRun) {
          logId = await logRuleExecution(em, {
            rule,
            context,
            conditionResult: false,
            actionsExecuted: null,
            executionTime,
            error: result.error,
          })

          await emitRuleExecutionFailed(options.eventBus, {
            ruleId: rule.ruleId,
            ruleName: rule.ruleName,
            entityType: context.entityType ?? null,
            errorMessage: result.error ?? null,
            tenantId: context.tenantId,
            organizationId: context.organizationId ?? null,
          })
        }

        return {
          rule,
          conditionResult: false,
          actionsExecuted: null,
          executionTime,
          error: result.error,
          logId,
        }
      }

      // Evaluation completed successfully - determine which actions to execute
      const actions = result.conditionsPassed ? rule.successActions : rule.failureActions

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

      let logId: string | undefined

      // Log execution if not dry run
      if (!context.dryRun) {
        logId = await logRuleExecution(em, {
          rule,
          context,
          conditionResult: result.conditionsPassed,
          actionsExecuted,
          executionTime,
        })
      }

      return {
        rule,
        conditionResult: result.conditionsPassed,
        actionsExecuted,
        executionTime,
        logId,
      }
    }

    // Execute with single rule timeout
    return await withTimeout(
      executeWithTimeout(),
      MAX_SINGLE_RULE_TIMEOUT_MS,
      `Single rule execution timeout [ruleId=${rule.ruleId}]`
    )
  } catch (error) {
    const executionTime = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    const enhancedError = `Failed to execute rule [ruleId=${rule.ruleId}, entityType=${context.entityType}]: ${errorMessage}`

    let logId: string | undefined

    // Log error if not dry run
    if (!context.dryRun) {
      logId = await logRuleExecution(em, {
        rule,
        context,
        conditionResult: false,
        actionsExecuted: null,
        executionTime,
        error: enhancedError,
      })

      await emitRuleExecutionFailed(options.eventBus, {
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        entityType: context.entityType ?? null,
        errorMessage: enhancedError,
        tenantId: context.tenantId,
        organizationId: context.organizationId ?? null,
      })
    }

    return {
      rule,
      conditionResult: false,
      actionsExecuted: null,
      executionTime,
      error: enhancedError,
      logId,
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
  // Validate input
  ruleDiscoveryOptionsSchema.parse(options)

  const { entityType, eventType, tenantId, organizationId, ruleType } = options

  const where: Partial<BusinessRule> = {
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

  const rules = await em.find(BusinessRule, where, {
    orderBy: { priority: 'DESC', ruleId: 'ASC' },
  })

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
 * Execute a specific rule by its database UUID
 * This bypasses the entityType/eventType discovery mechanism and directly executes the rule
 */
export async function executeRuleById(
  em: EntityManager,
  context: DirectRuleExecutionContext
): Promise<DirectRuleExecutionResult> {
  const startTime = Date.now()

  // Validate input
  const validation = directRuleExecutionContextSchema.safeParse(context)
  if (!validation.success) {
    const validationErrors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return {
      success: false,
      ruleId: context.ruleId,
      ruleName: 'Unknown',
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Validation failed: ${validationErrors.join(', ')}`,
    }
  }

  // Fetch rule by ID with tenant/org validation
  const rule = await em.findOne(BusinessRule, {
    id: context.ruleId,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    deletedAt: null,
  })

  if (!rule) {
    return {
      success: false,
      ruleId: context.ruleId,
      ruleName: 'Unknown',
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: 'Rule not found',
    }
  }

  if (!rule.enabled) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: 'Rule is disabled',
    }
  }

  // Check effective date range
  const now = new Date()
  if (rule.effectiveFrom && rule.effectiveFrom > now) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Rule is not yet effective (starts ${rule.effectiveFrom.toISOString()})`,
    }
  }
  if (rule.effectiveTo && rule.effectiveTo < now) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Rule has expired (ended ${rule.effectiveTo.toISOString()})`,
    }
  }

  // Build RuleEngineContext (use provided entityType or fall back to rule's)
  const engineContext: RuleEngineContext = {
    entityType: context.entityType || rule.entityType,
    entityId: context.entityId,
    eventType: context.eventType || rule.eventType || undefined,
    data: context.data,
    user: context.user,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    executedBy: context.executedBy,
    dryRun: context.dryRun,
  }

  // Execute via existing executeSingleRule
  const result = await executeSingleRule(em, rule, engineContext)

  return {
    success: !result.error,
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    conditionResult: result.conditionResult,
    actionsExecuted: result.actionsExecuted,
    executionTime: result.executionTime,
    error: result.error,
    logId: result.logId,
  }
}

/**
 * Execute a rule by its string rule_id identifier
 * Looks up rule by rule_id (string column) + tenant_id (unique constraint)
 * This is useful for workflow conditions that reference rules by their string identifiers
 */
export async function executeRuleByRuleId(
  em: EntityManager,
  context: RuleIdExecutionContext
): Promise<DirectRuleExecutionResult> {
  const startTime = Date.now()

  // Validate input
  const validation = ruleIdExecutionContextSchema.safeParse(context)
  if (!validation.success) {
    const validationErrors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)
    return {
      success: false,
      ruleId: context.ruleId || 'unknown',
      ruleName: 'Unknown',
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Validation failed: ${validationErrors.join(', ')}`,
    }
  }

  // Fetch rule by rule_id (string identifier) + tenant/org
  const rule = await em.findOne(BusinessRule, {
    ruleId: context.ruleId,  // String identifier column
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    deletedAt: null,
  })

  if (!rule) {
    return {
      success: false,
      ruleId: context.ruleId,
      ruleName: 'Unknown',
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: 'Rule not found',
    }
  }

  if (!rule.enabled) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: 'Rule is disabled',
    }
  }

  // Check effective date range
  const now = new Date()
  if (rule.effectiveFrom && rule.effectiveFrom > now) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Rule is not yet effective (starts ${rule.effectiveFrom.toISOString()})`,
    }
  }
  if (rule.effectiveTo && rule.effectiveTo < now) {
    return {
      success: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      conditionResult: false,
      actionsExecuted: null,
      executionTime: Date.now() - startTime,
      error: `Rule has expired (ended ${rule.effectiveTo.toISOString()})`,
    }
  }

  // Build RuleEngineContext (use provided entityType or fall back to rule's)
  const engineContext: RuleEngineContext = {
    entityType: context.entityType || rule.entityType,
    entityId: context.entityId,
    eventType: context.eventType || rule.eventType || undefined,
    data: context.data,
    user: context.user,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
    executedBy: context.executedBy,
    dryRun: context.dryRun,
  }

  // Execute via existing executeSingleRule
  const result = await executeSingleRule(em, rule, engineContext)

  return {
    success: !result.error,
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    conditionResult: result.conditionResult,
    actionsExecuted: result.actionsExecuted,
    executionTime: result.executionTime,
    error: result.error,
    logId: result.logId,
  }
}

/**
 * Sensitive field patterns to exclude from logs
 */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /pwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth/i,
  /credit[_-]?card/i,
  /card[_-]?number/i,
  /cvv/i,
  /ssn/i,
  /social[_-]?security/i,
  /tax[_-]?id/i,
  /driver[_-]?license/i,
  /passport/i,
]

/**
 * Maximum depth for nested object sanitization
 */
const MAX_SANITIZATION_DEPTH = 5

/**
 * Sanitize data for logging by removing sensitive fields
 */
function sanitizeForLogging(data: any, depth: number = 0): any {
  // Prevent infinite recursion
  if (depth > MAX_SANITIZATION_DEPTH) {
    return '[Max depth exceeded]'
  }

  // Handle null/undefined
  if (data === null || data === undefined) {
    return data
  }

  // Handle primitives
  if (typeof data !== 'object') {
    return data
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, depth + 1))
  }

  // Handle objects
  const sanitized: Record<string, any> = {}

  for (const [key, value] of Object.entries(data)) {
    // Check if field name matches sensitive patterns
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(key))

    if (isSensitive) {
      sanitized[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value, depth + 1)
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

/**
 * Sanitize user object for logging (keep only safe fields)
 */
function sanitizeUser(user: any): any {
  if (!user) {
    return undefined
  }

  // Only log safe user fields
  return {
    id: user.id,
    role: user.role,
    // Don't log: email, name, phone, address, etc.
  }
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
    ? EXECUTION_RESULT_ERROR
    : conditionResult
      ? EXECUTION_RESULT_SUCCESS
      : EXECUTION_RESULT_FAILURE

  const log = em.create(RuleExecutionLog, {
    rule,
    entityId: context.entityId || DEFAULT_ENTITY_ID,
    entityType: context.entityType,
    executionResult,
    inputContext: {
      data: sanitizeForLogging(context.data),
      eventType: context.eventType,
      user: sanitizeUser(context.user),
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

  return log.id
}

async function emitRuleExecutionFailed(
  eventBus: Pick<EventBus, 'emitEvent'> | null | undefined,
  payload: RuleExecutionFailedPayload
): Promise<void> {
  if (!eventBus?.emitEvent) return

  await eventBus.emitEvent('business_rules.rule.execution_failed', payload).catch(() => undefined)
}
