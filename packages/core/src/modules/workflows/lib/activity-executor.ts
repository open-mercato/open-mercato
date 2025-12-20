/**
 * Workflows Module - Activity Executor Service
 *
 * Executes workflow activities (send email, call API, emit events, etc.)
 * - Supports multiple activity types
 * - Implements retry logic with exponential backoff
 * - Handles timeouts
 * - Variable interpolation from workflow context
 *
 * Functional API (no classes) following Open Mercato conventions.
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'

// ============================================================================
// Types and Interfaces
// ============================================================================

export type ActivityType =
  | 'SEND_EMAIL'
  | 'EMIT_EVENT'
  | 'UPDATE_ENTITY'
  | 'CALL_WEBHOOK'
  | 'EXECUTE_FUNCTION'

export interface ActivityDefinition {
  activityName?: string // Optional, for debugging/logging
  activityType: ActivityType
  config: any
  retryPolicy?: RetryPolicy
  timeoutMs?: number
  compensate?: boolean // Flag to execute compensation on failure
}

export interface RetryPolicy {
  maxAttempts: number
  initialIntervalMs: number
  backoffCoefficient: number
  maxIntervalMs: number
}

export interface ActivityContext {
  workflowInstance: WorkflowInstance
  workflowContext: Record<string, any>
  stepContext?: Record<string, any>
  userId?: string
}

export interface ActivityExecutionResult {
  activityName?: string
  activityType: ActivityType
  success: boolean
  output?: any
  error?: string
  retryCount: number
  executionTimeMs: number
}

export class ActivityExecutionError extends Error {
  constructor(
    message: string,
    public activityType: ActivityType,
    public activityName?: string,
    public details?: any
  ) {
    super(message)
    this.name = 'ActivityExecutionError'
  }
}

// ============================================================================
// Main Activity Execution Functions
// ============================================================================

/**
 * Execute a single activity with retry logic and timeout
 *
 * @param em - Entity manager
 * @param container - DI container
 * @param activity - Activity definition
 * @param context - Execution context
 * @returns Execution result
 */
export async function executeActivity(
  em: EntityManager,
  container: AwilixContainer,
  activity: ActivityDefinition,
  context: ActivityContext
): Promise<ActivityExecutionResult> {
  const retryPolicy = activity.retryPolicy || {
    maxAttempts: 1,
    initialIntervalMs: 0,
    backoffCoefficient: 1,
    maxIntervalMs: 0,
  }

  let lastError: any
  let retryCount = 0

  for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt++) {
    try {
      const startTime = Date.now()

      // Execute with timeout if specified
      const result = activity.timeoutMs
        ? await executeWithTimeout(
            () => executeActivityByType(em, container, activity, context),
            activity.timeoutMs
          )
        : await executeActivityByType(em, container, activity, context)

      const executionTimeMs = Date.now() - startTime

      return {
        activityName: activity.activityName,
        activityType: activity.activityType,
        success: true,
        output: result,
        retryCount: attempt,
        executionTimeMs,
      }
    } catch (error) {
      lastError = error
      retryCount = attempt + 1

      // If not the last attempt, apply backoff and retry
      if (attempt < retryPolicy.maxAttempts - 1) {
        const backoff = calculateBackoff(
          retryPolicy.initialIntervalMs,
          retryPolicy.backoffCoefficient,
          attempt,
          retryPolicy.maxIntervalMs
        )

        await sleep(backoff)
      }
    }
  }

  // All retries exhausted
  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)

  return {
    activityName: activity.activityName,
    activityType: activity.activityType,
    success: false,
    error: `Activity failed after ${retryCount} attempts: ${errorMessage}`,
    retryCount,
    executionTimeMs: 0,
  }
}

/**
 * Execute multiple activities in sequence
 *
 * @param em - Entity manager
 * @param container - DI container
 * @param activities - Array of activity definitions
 * @param context - Execution context
 * @returns Array of execution results
 */
export async function executeActivities(
  em: EntityManager,
  container: AwilixContainer,
  activities: ActivityDefinition[],
  context: ActivityContext
): Promise<ActivityExecutionResult[]> {
  const results: ActivityExecutionResult[] = []

  for (const activity of activities) {
    const result = await executeActivity(em, container, activity, context)
    results.push(result)

    // Stop execution if activity fails (fail-fast)
    if (!result.success) {
      break
    }

    // Update workflow context with activity output
    if (result.output && typeof result.output === 'object') {
      const key = activity.activityName || activity.activityType
      context.workflowContext = {
        ...context.workflowContext,
        [key]: result.output,
      }
    }
  }

  return results
}

// ============================================================================
// Activity Type Handlers
// ============================================================================

/**
 * Execute activity based on its type
 */
async function executeActivityByType(
  em: EntityManager,
  container: AwilixContainer,
  activity: ActivityDefinition,
  context: ActivityContext
): Promise<any> {
  // Interpolate config variables from context
  const interpolatedConfig = interpolateVariables(activity.config, context.workflowContext)

  switch (activity.activityType) {
    case 'SEND_EMAIL':
      return await executeSendEmail(interpolatedConfig, context, container)

    case 'EMIT_EVENT':
      return await executeEmitEvent(interpolatedConfig, context, container)

    case 'UPDATE_ENTITY':
      return await executeUpdateEntity(em, interpolatedConfig, context, container)

    case 'CALL_WEBHOOK':
      return await executeCallWebhook(interpolatedConfig, context)

    case 'EXECUTE_FUNCTION':
      return await executeFunction(interpolatedConfig, context, container)

    default:
      throw new ActivityExecutionError(
        `Unknown activity type: ${activity.activityType}`,
        activity.activityType,
        activity.activityName
      )
  }
}

/**
 * SEND_EMAIL activity handler
 *
 * For MVP, this logs the email (actual email sending can be added later)
 */
async function executeSendEmail(
  config: any,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const { to, subject, template, templateData, body } = config

  if (!to || !subject) {
    throw new Error('SEND_EMAIL requires "to" and "subject" fields')
  }

  // For MVP: Log the email (actual email service integration can be added later)
  console.log(`[Workflow Activity] Send email to ${to}: ${subject}`)

  // Check if email service is available in container
  try {
    const emailService = container.resolve('emailService')
    if (emailService && typeof emailService.send === 'function') {
      await emailService.send({
        to,
        subject,
        template,
        templateData,
        body,
      })
      return { sent: true, to, subject, via: 'emailService' }
    }
  } catch (error) {
    // Email service not available, just log
  }

  return { sent: true, to, subject, via: 'console' }
}

/**
 * EMIT_EVENT activity handler
 *
 * Publishes a domain event to the event bus
 */
async function executeEmitEvent(
  config: any,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const { eventName, payload } = config

  if (!eventName) {
    throw new Error('EMIT_EVENT requires "eventName" field')
  }

  // Get event bus from container
  const eventBus = container.resolve('eventBus')

  if (!eventBus || typeof eventBus.emitEvent !== 'function') {
    throw new Error('Event bus not available in container')
  }

  // Publish event with workflow metadata
  const enrichedPayload = {
    ...payload,
    _workflow: {
      workflowInstanceId: context.workflowInstance.id,
      workflowId: context.workflowInstance.workflowId,
      tenantId: context.workflowInstance.tenantId,
      organizationId: context.workflowInstance.organizationId,
    },
  }

  await eventBus.emitEvent(eventName, enrichedPayload)

  return { emitted: true, eventName, payload: enrichedPayload }
}

/**
 * UPDATE_ENTITY activity handler
 *
 * Updates an entity via query engine
 */
async function executeUpdateEntity(
  em: EntityManager,
  config: any,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const { entityType, entityId, updates } = config

  if (!entityType || !entityId || !updates) {
    throw new Error('UPDATE_ENTITY requires "entityType", "entityId", and "updates" fields')
  }

  // Get query engine from container
  const queryEngine = container.resolve('queryEngine')

  if (!queryEngine || typeof queryEngine.update !== 'function') {
    throw new Error('Query engine not available in container')
  }

  // Execute update with tenant scoping
  await queryEngine.update({
    entity: entityType,
    where: { id: entityId },
    data: updates,
    tenantId: context.workflowInstance.tenantId,
    organizationId: context.workflowInstance.organizationId,
  })

  return { updated: true, entityType, entityId, updates }
}

/**
 * CALL_WEBHOOK activity handler
 *
 * Makes HTTP request to external URL
 */
async function executeCallWebhook(
  config: any,
  context: ActivityContext
): Promise<any> {
  const { url, method = 'POST', headers = {}, body } = config

  if (!url) {
    throw new Error('CALL_WEBHOOK requires "url" field')
  }

  // Make HTTP request
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  // Parse response
  let result: any
  const contentType = response.headers.get('content-type')

  if (contentType && contentType.includes('application/json')) {
    result = await response.json()
  } else {
    result = await response.text()
  }

  // Check for HTTP errors
  if (!response.ok) {
    throw new Error(
      `Webhook request failed with status ${response.status}: ${JSON.stringify(result)}`
    )
  }

  return {
    status: response.status,
    statusText: response.statusText,
    result,
  }
}

/**
 * EXECUTE_FUNCTION activity handler
 *
 * Calls a registered function from DI container
 */
async function executeFunction(
  config: any,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const { functionName, args = {} } = config

  if (!functionName) {
    throw new Error('EXECUTE_FUNCTION requires "functionName" field')
  }

  // Look up function in container
  const fnKey = `workflowFunction:${functionName}`

  try {
    const fn = container.resolve(fnKey)

    if (typeof fn !== 'function') {
      throw new Error(`Registered workflow function "${functionName}" is not a function`)
    }

    // Call function with args and context
    const result = await fn(args, context)

    return { executed: true, functionName, result }
  } catch (error) {
    if (error instanceof Error && error.message.includes('not registered')) {
      throw new Error(
        `Workflow function "${functionName}" not registered in DI container (key: ${fnKey})`
      )
    }
    throw error
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Interpolate variables in config from workflow context
 *
 * Supports syntax: {{context.field}} or {{context.nested.field}}
 */
function interpolateVariables(config: any, context: Record<string, any>): any {
  if (typeof config === 'string') {
    // Replace {{path}} with value from context
    return config.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = getNestedValue(context, path.trim())
      return value !== undefined ? String(value) : match
    })
  }

  if (Array.isArray(config)) {
    return config.map((item) => interpolateVariables(item, context))
  }

  if (config && typeof config === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(config)) {
      result[key] = interpolateVariables(value, context)
    }
    return result
  }

  return config
}

/**
 * Get nested value from object by path (e.g., "user.email")
 */
function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.')
  let value = obj

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part]
    } else {
      return undefined
    }
  }

  return value
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(
  initialIntervalMs: number,
  backoffCoefficient: number,
  attempt: number,
  maxIntervalMs: number
): number {
  const backoff = initialIntervalMs * Math.pow(backoffCoefficient, attempt)
  return Math.min(backoff, maxIntervalMs || Infinity)
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute a promise with timeout
 */
async function executeWithTimeout<T>(
  executor: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Activity execution timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([executor(), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}
