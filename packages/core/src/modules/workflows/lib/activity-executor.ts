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
import { createModuleQueue, Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import {
  assertSafeOutboundUrl,
  UnsafeOutboundUrlError,
  type HostLookup,
} from '@open-mercato/shared/lib/url-safety'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { callWebhookConfigSchema } from '../data/validators'
import { WorkflowActivityJob, WORKFLOW_ACTIVITIES_QUEUE_NAME } from './activity-queue-types'
import { logWorkflowEvent } from './event-logger'
import { parseDuration } from './duration'

export { isPrivateUrl } from '@open-mercato/shared/lib/network'

function isAllowPrivateWorkflowWebhookUrlsEnabled(): boolean {
  if (parseBooleanWithDefault(process.env.OM_WORKFLOWS_ALLOW_PRIVATE_URLS, false)) {
    return true
  }

  if (parseBooleanWithDefault(process.env.WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS, false)) {
    console.warn(
      '[CALL_WEBHOOK] WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS is deprecated. Use OM_WORKFLOWS_ALLOW_PRIVATE_URLS instead. SSRF protection is bypassed.'
    )
    return true
  }

  return false
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export type ActivityType =
  | 'SEND_EMAIL'
  | 'CALL_API'
  | 'EMIT_EVENT'
  | 'UPDATE_ENTITY'
  | 'CALL_WEBHOOK'
  | 'EXECUTE_FUNCTION'
  | 'WAIT'

export interface ActivityDefinition {
  activityId: string // Unique identifier for activity
  activityName?: string // Optional, for debugging/logging
  activityType: ActivityType
  config: any
  async?: boolean // Flag to execute activity asynchronously via queue
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
  stepInstanceId?: string
  transitionId?: string
  userId?: string
}

export interface ActivityExecutionResult {
  activityId: string
  activityName?: string
  activityType: ActivityType
  success: boolean
  output?: any
  error?: string
  retryCount: number
  executionTimeMs: number
  async?: boolean // Marks activity as async (queued)
  jobId?: string // Queue job ID for async activities
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
// Queue Integration for Async Activities
// ============================================================================

let activityQueue: Queue<WorkflowActivityJob> | null = null

/**
 * Get or create the activity queue (lazy initialization)
 */
function getActivityQueue(): Queue<WorkflowActivityJob> {
  if (!activityQueue) {
    activityQueue = createModuleQueue<WorkflowActivityJob>(
      WORKFLOW_ACTIVITIES_QUEUE_NAME,
      { concurrency: parseInt(process.env.WORKFLOW_WORKER_CONCURRENCY || '5') },
    )
  }

  return activityQueue
}

/**
 * Enqueue an activity for background execution
 *
 * @param em - Entity manager
 * @param activity - Activity definition
 * @param context - Execution context
 * @returns Job ID
 */
export async function enqueueActivity(
  em: EntityManager,
  activity: ActivityDefinition,
  context: ActivityContext
): Promise<string> {
  const { workflowInstance, workflowContext, stepContext, transitionId, stepInstanceId } =
    context

  // Interpolate config variables NOW (before queuing)
  const interpolatedConfig = interpolateVariables(activity.config, workflowContext, workflowInstance)

  // Create job payload
  const job: WorkflowActivityJob = {
    workflowInstanceId: workflowInstance.id,
    stepInstanceId,
    transitionId,
    activityId: activity.activityId,
    activityName: activity.activityName || activity.activityType,
    activityType: activity.activityType,
    activityConfig: interpolatedConfig,
    workflowContext,
    stepContext,
    retryPolicy: activity.retryPolicy,
    timeoutMs: activity.timeoutMs,
    tenantId: workflowInstance.tenantId,
    organizationId: workflowInstance.organizationId,
    userId: context.userId,
  }

  // Enqueue to queue (WAIT activities use delayMs for the actual delay)
  const queue = getActivityQueue()
  const enqueueOptions = activity.activityType === 'WAIT' && (interpolatedConfig.duration || interpolatedConfig.until)
    ? { delayMs: calculateWaitDelayMs(interpolatedConfig) }
    : undefined
  const jobId = await queue.enqueue(job, enqueueOptions)

  // Log event
  await logWorkflowEvent(em, {
    workflowInstanceId: workflowInstance.id,
    stepInstanceId,
    eventType: 'ACTIVITY_QUEUED',
    eventData: {
      activityId: activity.activityId,
      activityName: activity.activityName,
      activityType: activity.activityType,
      async: true,
      jobId,
    },
    tenantId: workflowInstance.tenantId,
    organizationId: workflowInstance.organizationId,
  })

  return jobId
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
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityType: activity.activityType,
        success: true,
        output: result,
        retryCount: attempt,
        executionTimeMs,
        async: activity.async || false,
      }
    } catch (error) {
      lastError = error
      retryCount = attempt + 1

      // Log activity retry attempt with context
      if (attempt < retryPolicy.maxAttempts - 1) {
        console.error(`[WORKFLOW] Activity ${activity.activityId} (${activity.activityType}) failed on attempt ${attempt + 1}/${retryPolicy.maxAttempts} (instance: ${context.workflowInstance.id}):`, error instanceof Error ? error.message : error)
      }

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
  console.error(`[WORKFLOW] Activity ${activity.activityId} (${activity.activityType}) failed after ${retryCount} attempts (instance: ${context.workflowInstance.id}): ${errorMessage}`)
  if (lastError instanceof Error && lastError.stack) {
    console.error('[WORKFLOW] Activity error stack:', lastError.stack)
  }

  return {
    activityId: activity.activityId,
    activityName: activity.activityName,
    activityType: activity.activityType,
    success: false,
    error: `Activity failed after ${retryCount} attempts: ${errorMessage}`,
    retryCount,
    executionTimeMs: 0,
    async: activity.async || false,
  }
}

/**
 * Execute multiple activities in sequence
 * Supports both synchronous and asynchronous (queued) execution
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

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i]

    // Check if activity should run async
    if (activity.async) {
      // Enqueue for background execution
      const jobId = await enqueueActivity(em, activity, context)

      results.push({
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityType: activity.activityType,
        success: true, // Queued successfully
        async: true,
        jobId,
        retryCount: 0,
        executionTimeMs: 0,
      })
    } else {
      // Execute synchronously (existing logic)
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
  // Interpolate config variables from context (including workflow metadata)
  const interpolatedConfig = interpolateVariables(activity.config, context.workflowContext, context.workflowInstance)

  switch (activity.activityType) {
    case 'SEND_EMAIL':
      return await executeSendEmail(interpolatedConfig, context, container)

    case 'CALL_API':
      return await executeCallApi(em, interpolatedConfig, context, container)

    case 'EMIT_EVENT':
      return await executeEmitEvent(interpolatedConfig, context, container)

    case 'UPDATE_ENTITY':
      return await executeUpdateEntity(em, interpolatedConfig, context, container)

    case 'CALL_WEBHOOK':
      return await executeCallWebhook(interpolatedConfig, context)

    case 'EXECUTE_FUNCTION':
      return await executeFunction(interpolatedConfig, context, container)

    case 'WAIT':
      return await executeWait(interpolatedConfig)

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
export async function executeSendEmail(
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
export async function executeEmitEvent(
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

  await eventBus.emitEvent(eventName, enrichedPayload, {
    tenantId: context.workflowInstance.tenantId,
    organizationId: context.workflowInstance.organizationId,
  })

  return { emitted: true, eventName, payload: enrichedPayload }
}

/**
 * UPDATE_ENTITY activity handler
 *
 * Updates an entity via CommandBus for proper audit logging, undo support, and side effects.
 *
 * Config format:
 * ```json
 * {
 *   "commandId": "sales.documents.update",
 *   "input": {
 *     "id": "{{context.orderId}}",
 *     "statusEntryId": "{{context.approvedStatusId}}"
 *   }
 * }
 * ```
 *
 * Alternative format with statusValue (auto-resolves to statusEntryId):
 * ```json
 * {
 *   "commandId": "sales.orders.update",
 *   "statusDictionary": "sales.order_status",
 *   "input": {
 *     "id": "{{context.id}}",
 *     "statusValue": "pending_approval"
 *   }
 * }
 * ```
 */
export async function executeUpdateEntity(
  em: EntityManager,
  config: any,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const { commandId, input, statusDictionary } = config

  if (!commandId) {
    throw new Error('UPDATE_ENTITY requires "commandId" field (e.g., "sales.documents.update")')
  }

  if (!input || typeof input !== 'object') {
    throw new Error('UPDATE_ENTITY requires "input" object with entity data')
  }

  // Resolve CommandBus from container
  const commandBus = container.resolve('commandBus') as any

  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('CommandBus not available in container')
  }

  // Prepare final input, resolving statusValue if provided
  let finalInput = { ...input }

  // If statusValue is provided with a statusDictionary, resolve it to statusEntryId
  if (finalInput.statusValue && statusDictionary) {
    const statusEntryId = await resolveDictionaryEntryId(
      em,
      statusDictionary,
      finalInput.statusValue,
      context.workflowInstance.tenantId,
      context.workflowInstance.organizationId
    )
    if (statusEntryId) {
      finalInput.statusEntryId = statusEntryId
    }
    delete finalInput.statusValue
  }

  // Build synthetic CommandRuntimeContext for workflow execution
  // Use nil UUID for system actions when no user context is available
  const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
  const ctx = {
    container,
    auth: {
      sub: context.userId || SYSTEM_USER_ID,
      tenantId: context.workflowInstance.tenantId,
      orgId: context.workflowInstance.organizationId,
      isSuperAdmin: false,
    },
    organizationScope: null,
    selectedOrganizationId: context.workflowInstance.organizationId,
    organizationIds: context.workflowInstance.organizationId
      ? [context.workflowInstance.organizationId]
      : null,
  }

  // Execute the command
  const { result, logEntry } = await commandBus.execute(commandId, {
    input: finalInput,
    ctx,
  })

  return {
    executed: true,
    commandId,
    result,
    logEntryId: logEntry?.id,
  }
}

/**
 * Helper to resolve dictionary entry ID by value
 */
async function resolveDictionaryEntryId(
  em: EntityManager,
  dictionaryKey: string,
  value: string,
  tenantId: string,
  organizationId: string
): Promise<string | null> {
  try {
    // Import here to avoid circular dependencies
    const { Dictionary, DictionaryEntry } = await import('@open-mercato/core/modules/dictionaries/data/entities')

    // Find the dictionary
    const dictionary = await em.findOne(Dictionary, {
      key: dictionaryKey,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!dictionary) {
      console.warn(`[UPDATE_ENTITY] Dictionary not found: ${dictionaryKey}`)
      return null
    }

    // Find the entry by normalized value
    const normalizedValue = value.toLowerCase().trim()
    const entry = await em.findOne(DictionaryEntry, {
      dictionary: dictionary.id,
      tenantId,
      organizationId,
      normalizedValue,
    })

    if (!entry) {
      console.warn(`[UPDATE_ENTITY] Dictionary entry not found: ${dictionaryKey}/${value}`)
      return null
    }

    return entry.id
  } catch (error) {
    console.error(`[UPDATE_ENTITY] Error resolving dictionary entry:`, error)
    return null
  }
}

/**
 * CALL_WEBHOOK activity handler
 *
 * Makes HTTP request to an external URL. Applies shared SSRF guard
 * (protocol / credentials / blocked host / private IP literal / DNS rebinding)
 * before issuing the request and rejects any 3xx redirect rather than following.
 */
export type CallWebhookDeps = {
  lookupHost?: HostLookup
  allowPrivate?: boolean
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function executeCallWebhook(
  config: unknown,
  context: ActivityContext,
  deps: CallWebhookDeps = {}
): Promise<any> {
  const parsed = callWebhookConfigSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ')
    throw new Error(`CALL_WEBHOOK config invalid: ${issues}`)
  }
  const { url, method, headers: rawHeaders, body } = parsed.data
  const headers = rawHeaders ?? {}

  const allowPrivate = deps.allowPrivate ?? isAllowPrivateWorkflowWebhookUrlsEnabled()

  try {
    await assertSafeOutboundUrl(url, {
      subject: 'Workflow webhook URL',
      allowPrivate,
      lookupHost: deps.lookupHost,
    })
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) {
      throw new Error(
        `CALL_WEBHOOK rejected unsafe URL (reason=${error.reason}): ${error.message}`
      )
    }
    throw error
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const response = await fetchImpl(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: deps.signal,
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    throw new Error(
      `CALL_WEBHOOK refused to follow redirect ${response.status} to ${
        location ?? '(no Location header)'
      }`
    )
  }

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
export async function executeFunction(
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

/**
 * Calculate delay in milliseconds from a WAIT activity config.
 * Supports either `duration` (relative, e.g. "PT5M") or `until` (absolute ISO 8601 datetime).
 */
function calculateWaitDelayMs(config: { duration?: string; until?: string }): number {
  if (config.until) {
    const targetDate = new Date(config.until)
    if (isNaN(targetDate.getTime())) {
      throw new Error(`WAIT activity: invalid "until" datetime: ${config.until}`)
    }
    const delayMs = targetDate.getTime() - Date.now()
    return Math.max(0, delayMs)
  }

  if (config.duration) {
    return parseDuration(config.duration)
  }

  throw new Error('WAIT activity requires "duration" (e.g., "PT5M", "1h") or "until" (ISO 8601 datetime)')
}

/**
 * WAIT activity handler
 *
 * Delays workflow execution for a configured duration or until a specific datetime.
 * - `duration`: relative delay (e.g. "PT5M", "1h", "30s")
 * - `until`: absolute datetime (e.g. "2026-04-15T10:00:00Z")
 * - Sync mode: blocks via sleep (suitable for short delays)
 * - Async mode: delay is handled by the queue's delayMs option;
 *   this handler returns immediately when called from the worker
 */
async function executeWait(config: any): Promise<any> {
  const durationMs = calculateWaitDelayMs(config)

  // In sync mode, actually sleep for the duration
  // In async mode (called from worker), the delay already happened via queue scheduling
  await sleep(durationMs)

  return { waited: true, durationMs }
}

/**
 * CALL_API activity handler
 *
 * Makes authenticated HTTP request to internal Open Mercato APIs
 * - Automatically creates one-time API key for authentication
 * - Injects tenant/organization context headers
 * - Validates URL security (SSRF prevention)
 * - Classifies errors (retriable vs non-retriable)
 * - Deletes API key after request (no stored credentials!)
 */
export async function executeCallApi(
  em: EntityManager,
  config: any,
  context: ActivityContext,
  container: AwilixContainer,
  signal?: AbortSignal
): Promise<any> {
  // 1. Interpolate variables in config (including {{workflow.*}}, {{context.*}}, {{env.*}}, {{now}})
  const interpolatedConfig = interpolateVariables(config, context.workflowContext, context.workflowInstance)

  const {
    endpoint,
    method = 'GET',
    headers = {},
    body,
    validateTenantMatch = true,
  } = interpolatedConfig


  if (!endpoint) {
    throw new Error('CALL_API requires "endpoint" field')
  }

  // 2. Build full URL (prepend APP_URL for relative paths)
  const fullUrl = buildApiUrl(endpoint)

  // 3. Import the one-time API key helper
  const { withOnetimeApiKey } = await import('../../api_keys/services/apiKeyService')

  // 4. Get EntityManager from container (for correct type)
  const apiKeyEm = container.resolve('em')

  // 5. Resolve the roles that the one-time API key will inherit.
  //
  // SECURITY: The key must never exceed the permissions of the human who
  //   triggered (or authored) this workflow. Previously this code looked up
  //   a role named "admin"/"superadmin" for the tenant and assigned it to
  //   the key — which allowed any non-admin workflow author with
  //   `workflows.definitions.edit` + `workflows.instances.create` to issue
  //   arbitrary administrative API calls via a CALL_API activity. See the
  //   SECURITY.md changelog entry for this fix.
  //
  //   The resolution strategy is:
  //     1. Use the workflow instance's `metadata.initiatedBy` user (whoever
  //        manually started the instance), when available. Only this user's
  //        current active roles are used — we never fall back to the author
  //        when the initiator is known, because that would escalate the
  //        initiator's privileges.
  //     2. Fall back to the workflow definition's `createdBy` (author) only
  //        when the instance was started by an event trigger with no user.
  //     3. If no traceable principal exists, the activity refuses to run —
  //        there is no "system" fallback that bypasses RBAC.
  const resolvedRoleIds = await resolveCallApiRoleIds(apiKeyEm, context.workflowInstance)

  if (resolvedRoleIds.length === 0) {
    throw new Error(
      `[CALL_API] Refusing to execute CALL_API for workflow instance ${context.workflowInstance.id}: ` +
      `no traceable user roles could be resolved from the workflow instance or definition. ` +
      `CALL_API activities must run under the identity of the user who triggered them.`
    )
  }

  // 6. Execute request with one-time API key scoped to the resolved user's roles
  return await withOnetimeApiKey(
    apiKeyEm,
    {
      name: `__workflow_${context.workflowInstance.id}__`,
      description: `One-time key for workflow ${context.workflowInstance.workflowId} instance ${context.workflowInstance.id}`,
      tenantId: context.workflowInstance.tenantId,
      organizationId: context.workflowInstance.organizationId,
      roles: resolvedRoleIds,
      expiresAt: null,
    },
    async (apiKeySecret) => {
      // Build request headers (auth + context + custom)
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `apikey ${apiKeySecret}`,
        'X-Tenant-Id': context.workflowInstance.tenantId,
        'X-Organization-Id': context.workflowInstance.organizationId,
        'X-Workflow-Instance-Id': context.workflowInstance.id,
        ...headers,
      }

      // Make HTTP request
      const response = await fetch(fullUrl, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      })

      // Parse response body (JSON-safe)
      let responseBody: any
      const contentType = response.headers.get('content-type')

      try {
        if (contentType && contentType.includes('application/json')) {
          responseBody = await response.json()
        } else {
          responseBody = await response.text()
        }
      } catch (error) {
        responseBody = null
      }

      // Check for HTTP errors and classify
      if (!response.ok) {
        classifyAndThrowError(response.status, responseBody, fullUrl)
      }

      // Validate tenant match (security check)
      if (validateTenantMatch && responseBody && typeof responseBody === 'object') {
        if (responseBody.tenantId && responseBody.tenantId !== context.workflowInstance.tenantId) {
          throw new Error(
            `Tenant ID mismatch: workflow expects ${context.workflowInstance.tenantId} but API returned ${responseBody.tenantId}`
          )
        }
      }

      // Return structured result
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
        authenticated: true,
        tenantId: context.workflowInstance.tenantId,
        organizationId: context.workflowInstance.organizationId,
      }
    }
  )
}

// ============================================================================
// CALL_API Helper Functions
// ============================================================================

export type CallApiInstanceLike = {
  id: string
  tenantId: string
  organizationId: string
  definitionId: string
  metadata?: { initiatedBy?: string | null } | null
}

async function resolveActiveRoleIdsForUser(
  em: any,
  userId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string[]> {
  const { findOneWithDecryption, findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const { User, UserRole, Role } = await import('../../auth/data/entities')

  const user = await findOneWithDecryption(em, User, {
    id: userId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }, {}, scope)
  if (!user) return []

  const userRoles = await findWithDecryption(
    em,
    UserRole,
    { user: user.id, deletedAt: null },
    { populate: ['role'] },
    scope,
  )
  const roleIds = userRoles
    .map((ur: any) => (typeof ur.role === 'string' ? ur.role : ur.role?.id))
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)

  if (roleIds.length === 0) return []

  const scopedRoles = await findWithDecryption(em, Role, {
    id: { $in: roleIds },
    tenantId: scope.tenantId,
    deletedAt: null,
  }, {}, scope)
  return scopedRoles.map((r: any) => r.id as string)
}

export async function resolveCallApiRoleIds(
  em: any,
  instance: CallApiInstanceLike
): Promise<string[]> {
  if (!instance.definitionId) return []

  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const { WorkflowDefinition } = await import('../data/entities')

  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }

  // 1. Prefer the triggering user (whoever manually started this instance).
  //    WorkflowInstance.metadata.initiatedBy is the canonical record of that
  //    principal for user-started instances; use their current role set so
  //    CALL_API never exceeds the initiator's permissions. Refuse if the
  //    initiator has no active scoped roles — do not fall back to the
  //    definition author, which would escalate the initiator's privileges.
  const initiatorUserId = instance.metadata?.initiatedBy ?? null
  if (initiatorUserId) {
    return resolveActiveRoleIdsForUser(em, initiatorUserId, scope)
  }

  // 2. Event-triggered instance with no human initiator: fall back to the
  //    definition author. Soft-deleted definitions must not mint keys.
  const definition = await findOneWithDecryption(em, WorkflowDefinition, {
    id: instance.definitionId,
    tenantId: instance.tenantId,
    deletedAt: null,
  }, {}, scope)
  const authorUserId = definition?.createdBy
  if (!authorUserId) return []

  return resolveActiveRoleIdsForUser(em, authorUserId, scope)
}

/**
 * Build full API URL from endpoint
 * - Relative paths (/api/...) → prepend APP_URL
 * - Absolute URLs → validate domain matches APP_URL (SSRF prevention)
 */
function buildApiUrl(endpoint: string): string {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'

  // Relative path - prepend APP_URL
  if (endpoint.startsWith('/')) {
    // Security: Only allow /api/* paths
    if (!endpoint.startsWith('/api/')) {
      throw new Error(`CALL_API only supports /api/* paths, got: ${endpoint}`)
    }
    return `${appUrl}${endpoint}`
  }

  // Absolute URL - validate domain matches APP_URL (SSRF prevention)
  try {
    const endpointUrl = new URL(endpoint)
    const appUrlObj = new URL(appUrl)

    if (endpointUrl.host !== appUrlObj.host) {
      throw new Error(
        `SSRF Prevention: CALL_API endpoint domain (${endpointUrl.host}) does not match APP_URL (${appUrlObj.host})`
      )
    }

    return endpoint
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid endpoint URL: ${endpoint}`)
    }
    throw error
  }
}

/**
 * Classify HTTP error and throw appropriate error
 * - 400-499: Non-retriable (client error - validation/auth)
 * - 500-599: Retriable (server error)
 */
function classifyAndThrowError(status: number, body: any, url: string): never {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)

  if (status >= 400 && status < 500) {
    // Client errors - non-retriable
    throw new Error(
      `CALL_API request failed with status ${status} (non-retriable): ${bodyStr}`
    )
  }

  if (status >= 500) {
    // Server errors - retriable
    const error: any = new Error(
      `CALL_API request failed with status ${status} (retriable): ${bodyStr}`
    )
    error.retriable = true
    throw error
  }

  // Other errors
  throw new Error(`CALL_API request failed with status ${status}: ${bodyStr}`)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Interpolate variables in config from workflow context
 *
 * Supports syntax:
 * - {{context.field}} or {{context.nested.field}} - from workflow context
 * - {{workflow.instanceId}} - workflow instance ID
 * - {{workflow.tenantId}} - tenant ID
 * - {{workflow.organizationId}} - organization ID
 * - {{workflow.currentStepId}} - current step ID
 * - {{env.VAR_NAME}} - environment variables
 * - {{now}} - current ISO timestamp
 */
function interpolateVariables(
  config: any,
  context: Record<string, any>,
  workflowInstance?: WorkflowInstance
): any {
  if (typeof config === 'string') {
    // Check if this is a single variable reference (e.g., "{{context.cart.items}}")
    // This preserves the original type (array, object, number, boolean)
    const singleVarMatch = config.match(/^\{\{([^}]+)\}\}$/)

    if (singleVarMatch) {
      const trimmedPath = singleVarMatch[1].trim()

      // Handle {{workflow.*}} variables
      if (trimmedPath.startsWith('workflow.') && workflowInstance) {
        const workflowKey = trimmedPath.substring('workflow.'.length)
        switch (workflowKey) {
          case 'instanceId':
            return workflowInstance.id
          case 'tenantId':
            return workflowInstance.tenantId
          case 'organizationId':
            return workflowInstance.organizationId
          case 'currentStepId':
            return workflowInstance.currentStepId
          case 'workflowId':
            return workflowInstance.workflowId
          case 'version':
            return workflowInstance.version // Return as number
          default:
            return config // Return original if unknown
        }
      }

      // Handle {{env.*}} variables
      if (trimmedPath.startsWith('env.')) {
        const envKey = trimmedPath.substring('env.'.length)
        return process.env[envKey] ?? config
      }

      // Handle {{now}} - current timestamp
      if (trimmedPath === 'now') {
        return new Date().toISOString()
      }

      // Handle {{context.*}} variables (default behavior)
      const contextPath = trimmedPath.startsWith('context.')
        ? trimmedPath.substring('context.'.length)
        : trimmedPath

      const value = getNestedValue(context, contextPath)
      return value !== undefined ? value : config // Return raw value to preserve type
    }

    // Multiple interpolations or mixed text - return string
    return config.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim()

      // Handle {{workflow.*}} variables
      if (trimmedPath.startsWith('workflow.') && workflowInstance) {
        const workflowKey = trimmedPath.substring('workflow.'.length)
        switch (workflowKey) {
          case 'instanceId':
            return workflowInstance.id
          case 'tenantId':
            return workflowInstance.tenantId
          case 'organizationId':
            return workflowInstance.organizationId
          case 'currentStepId':
            return workflowInstance.currentStepId
          case 'workflowId':
            return workflowInstance.workflowId
          case 'version':
            return String(workflowInstance.version)
          default:
            return match // Unknown workflow key
        }
      }

      // Handle {{env.*}} variables
      if (trimmedPath.startsWith('env.')) {
        const envKey = trimmedPath.substring('env.'.length)
        const envValue = process.env[envKey]
        return envValue !== undefined ? envValue : match
      }

      // Handle {{now}} - current timestamp
      if (trimmedPath === 'now') {
        return new Date().toISOString()
      }

      // Handle {{context.*}} variables (default behavior)
      const contextPath = trimmedPath.startsWith('context.')
        ? trimmedPath.substring('context.'.length)
        : trimmedPath

      const value = getNestedValue(context, contextPath)
      return value !== undefined ? String(value) : match
    })
  }

  if (Array.isArray(config)) {
    return config.map((item) => interpolateVariables(item, context, workflowInstance))
  }

  if (config && typeof config === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(config)) {
      result[key] = interpolateVariables(value, context, workflowInstance)
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
