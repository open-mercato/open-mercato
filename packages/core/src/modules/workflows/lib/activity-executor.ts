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
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../data/entities'
import { createModuleQueue, Queue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import {
  safeOutboundFetch,
  UnsafeOutboundUrlError,
  type HostLookup,
} from '@open-mercato/shared/lib/url-safety'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import {
  definitionDeclaresGrant,
  resolveWorkflowDefinitionExecutionUserId,
} from './definition-grant'
import {
  callWebhookConfigSchema,
  invokeAgentConfigSchema,
  setVariableConfigSchema,
} from '../data/activity-config-schemas'
import {
  buildSetVariableContextPatch,
  isSetVariableOutput,
  splitAssignmentPath,
  type SetVariableOutput,
} from './set-variable'
import {
  DRY_RUN_EVENT_TYPES,
  WorkflowDryRunRefusalError,
  isDryRunInstance,
  isDryRunRefusal,
} from './dry-run'
import {
  applyTransforms,
  parseInterpolationToken,
  type WorkflowInterpolationMode,
} from './interpolation-pipeline'

export { resolveDefinitionInterpolationMode, type WorkflowInterpolationMode } from './interpolation-pipeline'
import {
  WorkflowActivityJob,
  WorkflowActivityJobInvokeAgent,
  WORKFLOW_ACTIVITIES_QUEUE_NAME,
  WORKFLOW_INVOKE_AGENT_QUEUE_NAME,
} from './activity-queue-types'
import './activity-registry-bootstrap'
import { bindActivityExecutor } from './activity-types'
import { getActivityType } from './activity-registry'
import { logWorkflowEvent } from './event-logger'
import { calculateWaitDelayMs, parseDuration } from './duration'

export { calculateWaitDelayMs } from './duration'
import { getWorkflowSafeCommand } from './workflow-safe-commands'
import { isWorkflowCommandEnabled } from './workflow-command-enablement'
import { resolveWorkflowCommandPolicyForContainer } from './workflow-command-settings'
import { resolveAgentReview, toAgentDispositionReview } from './agent-review'
import type { AgentDispositionReview } from './agent-disposition-task'

export { isPrivateUrl } from '@open-mercato/shared/lib/network'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

function isAllowPrivateWorkflowWebhookUrlsEnabled(): boolean {
  if (parseBooleanWithDefault(process.env.OM_WORKFLOWS_ALLOW_PRIVATE_URLS, false)) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('OM_WORKFLOWS_ALLOW_PRIVATE_URLS is set but ignored in production. SSRF protection remains enabled.', { component: 'CALL_WEBHOOK' })
      return false
    }

    logger.warn('OM_WORKFLOWS_ALLOW_PRIVATE_URLS is enabled. SSRF protection is bypassed for workflow webhooks; use only in development.', { component: 'CALL_WEBHOOK' })
    return true
  }

  if (parseBooleanWithDefault(process.env.WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS, false)) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS is deprecated and ignored in production. Use OM_WORKFLOWS_ALLOW_PRIVATE_URLS for development only. SSRF protection remains enabled.', { component: 'CALL_WEBHOOK' })
      return false
    }

    logger.warn('WORKFLOW_WEBHOOK_ALLOW_PRIVATE_URLS is deprecated. Use OM_WORKFLOWS_ALLOW_PRIVATE_URLS instead. SSRF protection is bypassed.', { component: 'CALL_WEBHOOK' })
    return true
  }

  return false
}

const DEFAULT_WORKFLOW_ENV_INTERPOLATION_ALLOWLIST = new Set(['APP_URL'])
const WORKFLOW_ENV_INTERPOLATION_ALLOWLIST_KEY = 'OM_WORKFLOWS_ENV_INTERPOLATION_ALLOWLIST'

function getWorkflowEnvInterpolationAllowlist(): Set<string> {
  const allowlist = new Set(DEFAULT_WORKFLOW_ENV_INTERPOLATION_ALLOWLIST)
  const configuredKeys = process.env[WORKFLOW_ENV_INTERPOLATION_ALLOWLIST_KEY]
  if (!configuredKeys) {
    return allowlist
  }

  for (const key of configuredKeys.split(',')) {
    const trimmedKey = key.trim()
    if (trimmedKey) {
      allowlist.add(trimmedKey)
    }
  }

  return allowlist
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
  | 'SET_VARIABLE'
  | 'INVOKE_AGENT'

/**
 * Signal name the INVOKE_AGENT step parks on when a proposal is routed to a
 * human. agent_orchestrator's proposal-dispose path emits
 * `agent_orchestrator.proposal.ready` and calls workflows `sendSignal` with this
 * name to resume the parked step.
 */
export const INVOKE_AGENT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'

/**
 * Signal name a parked SUB_WORKFLOW step resumes on once its child instance
 * reaches a terminal state. `completeWorkflow` enqueues a resume job when the
 * child carries a parent linkage; the worker resumes the parent step via
 * `sendSignal` with this name.
 */
export const SUB_WORKFLOW_SIGNAL_NAME = 'workflows.sub_workflow.completed'

/**
 * Small enqueue delay for the INVOKE_AGENT job so the workflow transaction that
 * parked the step commits before the worker picks the job up. The worker also
 * guards against the race (it requires the instance to be PAUSED at the step
 * before running the agent), so this only trims needless retries.
 */
export const INVOKE_AGENT_ENQUEUE_DELAY_MS = 1000

/**
 * Marker carried on an activity result's output when the step must park and wait
 * for a signal (INVOKE_AGENT routed a proposal to a human). The step handler
 * inspects activity outputs for this marker and parks the instance accordingly.
 * researcher / auto_approved outcomes do NOT carry it and proceed inline.
 */
export type ActivityParkMarker = { signalName: string }

export function getActivityParkMarker(output: unknown): ActivityParkMarker | null {
  if (output && typeof output === 'object' && '__park' in output) {
    const park = (output as { __park?: unknown }).__park
    if (park && typeof park === 'object' && typeof (park as { signalName?: unknown }).signalName === 'string') {
      return { signalName: (park as { signalName: string }).signalName }
    }
  }
  return null
}

export interface ActivityDefinition {
  activityId: string // Unique identifier for activity
  activityName?: string // Optional, for debugging/logging
  activityType: ActivityType
  config: any
  async?: boolean // Flag to execute activity asynchronously via queue
  retryPolicy?: RetryPolicy
  timeoutMs?: number
  /**
   * @deprecated Use `timeoutMs`. Legacy ISO 8601 duration string accepted by
   * the definition schema before #4424; normalized by `resolveActivityTimeoutMs`.
   */
  timeout?: string
  compensate?: boolean // Flag to execute compensation on failure
}

/**
 * Effective timeout for an activity, in milliseconds.
 *
 * The editor and this executor both speak `timeoutMs`, but the definition
 * schema historically accepted only an ISO 8601 `timeout` string — so stored
 * definitions can carry either. Prefer `timeoutMs`; fall back to parsing
 * `timeout`, ignoring a malformed value rather than throwing mid-execution
 * (an unparseable timeout must not fail an activity that would otherwise
 * succeed). Returns undefined when no usable timeout is configured (#4424).
 */
export function resolveActivityTimeoutMs(activity: {
  timeoutMs?: number
  timeout?: string
}): number | undefined {
  if (typeof activity.timeoutMs === 'number' && activity.timeoutMs > 0) {
    return activity.timeoutMs
  }
  if (typeof activity.timeout === 'string' && activity.timeout.trim().length > 0) {
    try {
      const parsed = parseDuration(activity.timeout.trim())
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    } catch {
      return undefined
    }
  }
  return undefined
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
  // Set when the activity runs inside a parallel branch; carried on the queue
  // payload so async resume targets the branch rather than the instance.
  branchInstanceId?: string | null
  transitionId?: string
  userId?: string
  // The owning definition's `interpolation` mode; absent means lenient.
  // Async activities enforce strict mode at enqueue-time, so the worker-side
  // context deliberately leaves this unset.
  interpolationMode?: WorkflowInterpolationMode
}

type RbacFeatureResolver = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    opts: { tenantId: string | null; organizationId: string | null }
  ) => Promise<boolean>
}

async function workflowUserHasAllFeatures(
  container: AwilixContainer,
  userId: string,
  required: readonly string[],
  tenantId: string | null,
  organizationId: string | null
): Promise<boolean> {
  try {
    const rbac = container.resolve('rbacService') as RbacFeatureResolver | undefined
    if (rbac?.userHasAllFeatures) {
      return await rbac.userHasAllFeatures(userId, [...required], { tenantId, organizationId })
    }
  } catch {
    // Fail closed below when the workflow executor cannot prove the actor's grants.
  }
  return false
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
  /**
   * The activity was not attempted because a dry run cannot simulate its type
   * (spec section 8.2). Callers MUST treat it as a stop, never as a failure:
   * error routes and error directives describe what to do when an effector
   * fails, and no effector ran.
   */
  dryRunRefused?: boolean
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

/**
 * Thrown by `interpolateVariables` in strict mode when a token cannot be
 * resolved (unresolved context path, env-allowlist miss, unknown workflow.*
 * key, failed or unparseable transform pipeline). Activity call sites rethrow
 * it as `ActivityExecutionError` so it flows through the normal retry/failure
 * machinery.
 */
export class WorkflowInterpolationError extends Error {
  constructor(
    message: string,
    public token: string
  ) {
    super(message)
    this.name = 'WorkflowInterpolationError'
  }
}

// ============================================================================
// Queue Integration for Async Activities
// ============================================================================

let activityQueue: Queue<WorkflowActivityJob> | null = null
let invokeAgentQueue: Queue<WorkflowActivityJob> | null = null

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
 * Get or create the dedicated invoke-agent queue (lazy initialization).
 *
 * Minute-long agent runs get their own queue so they never starve the fast
 * activities sharing 'workflow-activities'. Consumer-side concurrency is
 * governed by the workflow-invoke-agent worker's metadata.
 */
function getInvokeAgentQueue(): Queue<WorkflowActivityJob> {
  if (!invokeAgentQueue) {
    invokeAgentQueue = createModuleQueue<WorkflowActivityJob>(
      WORKFLOW_INVOKE_AGENT_QUEUE_NAME,
      { concurrency: parseInt(process.env.WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY || '5', 10) },
    )
  }

  return invokeAgentQueue
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
  const { workflowInstance, workflowContext, stepContext, transitionId, stepInstanceId, branchInstanceId } =
    context

  const registryEntry = getActivityType(activity.activityType)
  if (registryEntry && registryEntry.async.capable === false) {
    throw new ActivityExecutionError(
      `[internal] Activity type ${activity.activityType} cannot run asynchronously (${registryEntry.async.reason})`,
      activity.activityType,
      activity.activityName
    )
  }

  // Interpolate config variables NOW (before queuing) — strict mode is
  // enforced here, at enqueue-time, before the job serializes frozen config.
  const interpolatedConfig = interpolateActivityConfig(
    activity.config,
    context,
    activity.activityType,
    activity.activityName
  )

  // Create job payload
  const job: WorkflowActivityJob = {
    workflowInstanceId: workflowInstance.id,
    stepInstanceId,
    branchInstanceId: branchInstanceId ?? undefined,
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

  // Enqueue to queue (entries with enqueueDelayMs, e.g. WAIT, use delayMs for the actual delay)
  const queue = getActivityQueue()
  const registryDelayMs = registryEntry?.enqueueDelayMs
    ? registryEntry.enqueueDelayMs(interpolatedConfig)
    : null
  const enqueueOptions = registryDelayMs !== null ? { delayMs: registryDelayMs } : undefined
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

/**
 * Enqueue a delayed timer job for a WAIT_FOR_TIMER step.
 *
 * The activity worker handles `kind: 'timer'` jobs by calling
 * `timerHandler.fireTimer`, which resumes the paused workflow instance.
 */
export async function enqueueTimerJob(params: {
  workflowInstanceId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  tenantId: string
  organizationId: string
  userId?: string
  fireAt: string
  delayMs: number
}): Promise<string> {
  const { workflowInstanceId, stepInstanceId, branchInstanceId, tenantId, organizationId, userId, fireAt, delayMs } =
    params

  const queue = getActivityQueue()
  const jobId = await queue.enqueue(
    {
      kind: 'timer',
      workflowInstanceId,
      stepInstanceId,
      branchInstanceId: branchInstanceId ?? undefined,
      tenantId,
      organizationId,
      userId,
      fireAt,
    },
    { delayMs: delayMs > 0 ? delayMs : undefined }
  )

  return jobId
}

/**
 * Enqueue a delayed SLA job for a USER_TASK (one reminder offset, or the
 * deadline itself).
 *
 * The activity worker handles `kind: 'task_sla'` jobs by calling
 * `taskSla.runTaskSlaJob`. `deadlineAt` is absolute and carried on the payload
 * rather than recomputed at run time, so a queue running behind can never
 * extend the configured deadline — the same guarantee the WAIT_FOR_CONDITION
 * backstop gives.
 */
export async function enqueueTaskSlaJob(params: {
  workflowInstanceId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  userTaskId: string
  phase: 'reminder' | 'breach'
  deadlineAt: string
  fireAt: string
  delayMs: number
  tenantId: string
  organizationId: string
  userId?: string
}): Promise<string> {
  const {
    workflowInstanceId,
    stepInstanceId,
    branchInstanceId,
    userTaskId,
    phase,
    deadlineAt,
    fireAt,
    delayMs,
    tenantId,
    organizationId,
    userId,
  } = params

  const queue = getActivityQueue()
  return await queue.enqueue(
    {
      kind: 'task_sla',
      workflowInstanceId,
      stepInstanceId,
      branchInstanceId: branchInstanceId ?? undefined,
      userTaskId,
      phase,
      deadlineAt,
      fireAt,
      tenantId,
      organizationId,
      userId,
    },
    { delayMs: delayMs > 0 ? delayMs : undefined }
  )
}

/**
 * Enqueue a delayed poll job for a WAIT_FOR_CONDITION step.
 *
 * The activity worker handles `kind: 'condition'` jobs by calling
 * `conditionHandler.evaluateWaitCondition`. This job is the durability
 * backstop behind the event-driven wake: `deadlineAt` travels unchanged across
 * every re-enqueue so the timeout stays anchored to the original step entry.
 */
export async function enqueueConditionCheckJob(params: {
  workflowInstanceId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  tenantId: string
  organizationId: string
  userId?: string
  deadlineAt: string
  attempt: number
  delayMs: number
}): Promise<string> {
  const {
    workflowInstanceId,
    stepInstanceId,
    branchInstanceId,
    tenantId,
    organizationId,
    userId,
    deadlineAt,
    attempt,
    delayMs,
  } = params

  const queue = getActivityQueue()
  const jobId = await queue.enqueue(
    {
      kind: 'condition',
      workflowInstanceId,
      stepInstanceId,
      branchInstanceId: branchInstanceId ?? undefined,
      tenantId,
      organizationId,
      userId,
      deadlineAt,
      attempt,
    },
    { delayMs: delayMs > 0 ? delayMs : undefined }
  )

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

      // Execute with timeout if specified (timeoutMs, or a legacy ISO 8601
      // `timeout` string normalized to ms — see resolveActivityTimeoutMs).
      const timeoutMs = resolveActivityTimeoutMs(activity)
      const result = timeoutMs
        ? await executeWithTimeout(
            (signal) => executeActivityByType(em, container, activity, context, signal),
            timeoutMs
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

      // A dry-run refusal is not a failure — nothing was attempted — so retrying
      // it would only re-log the same refusal N times before reaching the same
      // answer.
      if (isDryRunRefusal(error)) break

      // Log activity retry attempt with context
      if (attempt < retryPolicy.maxAttempts - 1) {
        logger.error('Activity failed; will retry', {
          activityId: activity.activityId,
          activityType: activity.activityType,
          attempt: attempt + 1,
          maxAttempts: retryPolicy.maxAttempts,
          instanceId: context.workflowInstance.id,
          err: error,
        })
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
  if (isDryRunRefusal(lastError)) {
    return {
      activityId: activity.activityId,
      activityName: activity.activityName,
      activityType: activity.activityType,
      success: false,
      dryRunRefused: true,
      error: `Dry run stopped: activity type ${lastError.activityType} cannot be simulated (${lastError.reason})`,
      retryCount: 0,
      executionTimeMs: 0,
      async: activity.async || false,
    }
  }
  logger.error('Activity failed after all attempts', {
    activityId: activity.activityId,
    activityType: activity.activityType,
    attempts: retryCount,
    instanceId: context.workflowInstance.id,
    err: lastError,
  })

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

  // A dry run never enqueues. The queue job would carry no `isDryRun` of its
  // own, so a worker picking it up would execute the real effector on its own
  // connection — the isolation would leak out of the request that opted in.
  // Mocks are pure and synchronous, so running them inline loses nothing.
  const forceSynchronous = isDryRunInstance(context.workflowInstance)

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i]

    // Check if activity should run async
    if (activity.async && !forceSynchronous) {
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
      const executed = await executeActivity(em, container, activity, context)
      // `executeActivity` echoes the AUTHORED `async` flag, which is what the
      // transition handler reads to decide whether to park the token in
      // WAITING_FOR_ACTIVITIES. A dry run that ran an authored-async activity
      // inline must therefore correct the flag, or the run would park waiting
      // for a queue job that was deliberately never enqueued — a deadlock, and
      // the step handler would also misclassify a refusal as "still pending"
      // instead of a failure.
      const result = forceSynchronous && activity.async
        ? { ...executed, async: false }
        : executed
      results.push(result)

      // Stop execution if activity fails (fail-fast)
      if (!result.success) {
        break
      }

      // Update workflow context with activity output. SET_VARIABLE outputs
      // land at their assignment paths in top-level context; every other
      // output merges under the activity name/type key.
      if (result.output && typeof result.output === 'object') {
        if (activity.activityType === 'SET_VARIABLE' && isSetVariableOutput(result.output)) {
          context.workflowContext = {
            ...context.workflowContext,
            ...buildSetVariableContextPatch(context.workflowContext, result.output.assignments),
          }
        } else {
          const key = activity.activityName || activity.activityType
          context.workflowContext = {
            ...context.workflowContext,
            [key]: result.output,
          }
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
  context: ActivityContext,
  signal?: AbortSignal
): Promise<any> {
  // Interpolate config variables from context (including workflow metadata)
  const interpolatedConfig = interpolateActivityConfig(
    activity.config,
    context,
    activity.activityType,
    activity.activityName
  )

  const entry = getActivityType(activity.activityType)
  if (!entry) {
    throw new ActivityExecutionError(
      `Unknown activity type: ${activity.activityType}`,
      activity.activityType,
      activity.activityName
    )
  }

  // Dry run (spec section 8.2): the ONE place `entry.execute` is reached, so it
  // is the one place the swap has to happen. Everything side-effecting in the
  // engine ends up here — the command bus, the event bus, the mailer, the
  // webhook fetch and the agent bridge — which is what makes "no effector runs"
  // a property of a single branch rather than a checklist.
  if (isDryRunInstance(context.workflowInstance)) {
    if (entry.mock === 'refuse' || entry.mock === undefined) {
      const refusal = new WorkflowDryRunRefusalError(
        activity.activityType,
        entry.mock === 'refuse' ? 'refused' : 'noMock',
        activity.activityName,
      )
      await logWorkflowEvent(em, {
        workflowInstanceId: context.workflowInstance.id,
        stepInstanceId: context.stepInstanceId,
        eventType: DRY_RUN_EVENT_TYPES.activityRefused,
        eventData: {
          activityId: activity.activityId,
          activityName: activity.activityName,
          activityType: activity.activityType,
          reason: refusal.reason,
        },
        tenantId: context.workflowInstance.tenantId,
        organizationId: context.workflowInstance.organizationId,
      })
      throw refusal
    }

    const simulated = entry.mock(interpolatedConfig, context)
    await logWorkflowEvent(em, {
      workflowInstanceId: context.workflowInstance.id,
      stepInstanceId: context.stepInstanceId,
      eventType: DRY_RUN_EVENT_TYPES.activitySimulated,
      eventData: {
        activityId: activity.activityId,
        activityName: activity.activityName,
        activityType: activity.activityType,
        output: simulated ?? null,
      },
      tenantId: context.workflowInstance.tenantId,
      organizationId: context.workflowInstance.organizationId,
    })
    return simulated
  }

  // `signal` MUST reach the registry entry: CALL_API / CALL_WEBHOOK thread it
  // into fetch, and without it a per-activity timeout rejects the promise while
  // the HTTP request stays in flight — the phantom-execution bug from #4918.
  return await entry.execute(interpolatedConfig, context, {
    em: em as PostgreSqlEntityManager,
    container,
    signal,
  })
}

/**
 * SEND_EMAIL activity handler
 *
 * Sends via the DI-registered emailService when available; without one it
 * reports an honest stub result ({ sent: false, simulated: true, reason: 'no-email-service' }).
 * A real send() failure propagates so the activity retry loop handles it.
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

  logger.info('Send email activity invoked', { component: 'SEND_EMAIL', subject })

  let emailService: { send: (input: unknown) => Promise<unknown> | unknown } | undefined
  try {
    emailService = container.resolve<{ send: (input: unknown) => Promise<unknown> | unknown }>('emailService')
  } catch {
    emailService = undefined
  }

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

  logger.warn('SEND_EMAIL has no registered email service; email was not sent', { component: 'SEND_EMAIL', subject })
  return { sent: false, simulated: true, to, subject, via: 'console', reason: 'no-email-service' }
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

  // Emissions are fire-and-forget and no subscriber validates the payload shape,
  // so an unresolved `{{context.x}}` here is even quieter than on the command
  // path — it ships the literal template to every consumer. Fail loudly instead.
  const unresolvedPayloadKeys = findUnresolvedTemplateKeys(payload)
  if (unresolvedPayloadKeys.length > 0) {
    throw new Error(
      `EMIT_EVENT payload contains unresolved template variables for: ${unresolvedPayloadKeys.join(', ')}. ` +
        `Check that the workflow context provides these keys.`
    )
  }

  // Get event bus from container
  const eventBus = container.resolve<{ emitEvent: (event: string, payload: unknown, options?: unknown) => Promise<unknown> | unknown }>('eventBus')

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

const UNRESOLVED_TEMPLATE_PATTERN = /\{\{[^}]+\}\}/

function findUnresolvedTemplateKeys(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    return UNRESOLVED_TEMPLATE_PATTERN.test(value) ? [path] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUnresolvedTemplateKeys(item, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) =>
      findUnresolvedTemplateKeys(nested, path ? `${path}.${key}` : key)
    )
  }
  return []
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
 *     "id": "{{context.orderId}}",
 *     "statusValue": "pending_approval"
 *   }
 * }
 * ```
 *
 * Every `{{...}}` reference in `input` must resolve against the workflow context —
 * an unresolved reference is rejected rather than forwarded to the command bus.
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

  // Gate 1 — the CODE declares this command possible.
  const workflowSafeCommand = getWorkflowSafeCommand(commandId)
  if (!workflowSafeCommand) {
    throw new Error('UPDATE_ENTITY command is not allowed')
  }

  // Gate 2 — this TENANT switched it on. A tenant that never saved the setting
  // resolves to the grandfathered set, so this is byte-identical to the
  // pre-setting behaviour for every existing tenant.
  const commandPolicy = await resolveWorkflowCommandPolicyForContainer(
    container,
    context.workflowInstance.tenantId,
  )
  if (!isWorkflowCommandEnabled(workflowSafeCommand, commandPolicy)) {
    throw new Error('UPDATE_ENTITY command is not enabled for this tenant')
  }

  if (!input || typeof input !== 'object') {
    throw new Error('UPDATE_ENTITY requires "input" object with entity data')
  }

  const actorUserId = typeof context.userId === 'string' ? context.userId.trim() : ''
  if (!actorUserId) {
    throw new Error('UPDATE_ENTITY requires an authenticated workflow user')
  }

  const authorized = await workflowUserHasAllFeatures(
    container,
    actorUserId,
    workflowSafeCommand.requiredFeatures,
    context.workflowInstance.tenantId,
    context.workflowInstance.organizationId
  )
  if (!authorized) {
    throw new Error('UPDATE_ENTITY command is not authorized')
  }

  // Resolve CommandBus from container
  const commandBus = container.resolve('commandBus') as any

  if (!commandBus || typeof commandBus.execute !== 'function') {
    throw new Error('CommandBus not available in container')
  }

  const unresolvedKeys = findUnresolvedTemplateKeys(input)
  if (unresolvedKeys.length > 0) {
    throw new Error(
      `UPDATE_ENTITY input contains unresolved template variables for: ${unresolvedKeys.join(', ')}. ` +
        `Check that the workflow context provides these keys.`
    )
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
  const ctx = {
    container,
    auth: {
      sub: actorUserId,
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
      logger.warn('Dictionary not found', { component: 'UPDATE_ENTITY', dictionaryKey })
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
      logger.warn('Dictionary entry not found', { component: 'UPDATE_ENTITY', dictionaryKey, value })
      return null
    }

    return entry.id
  } catch (error) {
    logger.error('Error resolving dictionary entry', { component: 'UPDATE_ENTITY', err: error })
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

  let response: Response
  try {
    response = await safeOutboundFetch(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: deps.signal,
      },
      {
        subject: 'Workflow webhook URL',
        allowPrivate,
        lookupHost: deps.lookupHost,
        fetchImpl: deps.fetchImpl,
      },
    )
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) {
      throw new Error(
        `CALL_WEBHOOK rejected unsafe URL (reason=${error.reason}): ${error.message}`
      )
    }
    throw error
  }

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
 * WAIT activity handler
 *
 * Delays workflow execution for a configured duration or until a specific datetime.
 * - `duration`: relative delay (e.g. "PT5M", "1h", "30s")
 * - `until`: absolute datetime (e.g. "2026-04-15T10:00:00Z")
 * - Sync mode: blocks via sleep (suitable for short delays)
 * - Async mode: delay is handled by the queue's delayMs option;
 *   this handler returns immediately when called from the worker
 */
export async function executeWait(config: any): Promise<any> {
  const durationMs = calculateWaitDelayMs(config)

  // In sync mode, actually sleep for the duration
  // In async mode (called from worker), the delay already happened via queue scheduling
  await sleep(durationMs)

  return { waited: true, durationMs }
}

/**
 * SET_VARIABLE activity handler
 *
 * Validates the (already interpolated) assignments and echoes them back as
 * `{ assignments }`. The sync merge points detect this output shape via
 * `isSetVariableOutput` and apply each assignment at its dot path in
 * top-level workflow context (see lib/set-variable.ts) instead of
 * namespacing the output under the activity name/type key.
 */
export async function executeSetVariable(
  config: unknown,
  context: ActivityContext
): Promise<SetVariableOutput> {
  const parsed = setVariableConfigSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ')
    throw new Error(`SET_VARIABLE config invalid: ${issues}`)
  }

  for (const assignment of parsed.data.assignments) {
    const segments = splitAssignmentPath(assignment.path)
    if (segments === null) {
      throw new Error(
        `SET_VARIABLE assignment path contains a forbidden segment (__proto__, constructor, prototype): "${assignment.path}"`
      )
    }
    if (segments.length === 0) {
      throw new Error(`SET_VARIABLE assignment path is blank: "${assignment.path}"`)
    }
  }

  return { assignments: parsed.data.assignments }
}

/**
 * INVOKE_AGENT activity handler
 *
 * Runs a callable agent via the agent_orchestrator DI bridge (`agentWorkflowBridge`,
 * an optional peer) and dispositions any proposal:
 * - researcher → returns the agent data; the step proceeds inline (no park).
 * - auto_approved → returns the proposalId; the step proceeds inline (no park).
 * - user_task → returns a result carrying a `__park` marker so the step handler
 *   parks the instance on `INVOKE_AGENT_SIGNAL_NAME`; agent_orchestrator's
 *   dispose path later signals it to resume.
 *
 * `config` is the already-interpolated INVOKE_AGENT config.
 */
type AgentWorkflowBridgeLike = {
  invokeAgentForWorkflow: (args: {
    agentId: string
    input: unknown
    onResult: { autoApproveThreshold: number; autoApproveMargin?: number } | { alwaysAsk: true }
    ctx: {
      tenantId: string
      organizationId: string
      userId?: string
      processId: string
      stepId: string
      // Optional interpolated business-record descriptor (invokeAgentConfigSchema.subject).
      subject?: unknown
      // Optional already-resolved Review section (spec 7.5) — who reviews the
      // proposal this step raises, and by when. Absent means the unassigned
      // task the disposition service raised before the section existed.
      review?: AgentDispositionReview
    }
  }) => Promise<
    | { kind: 'researcher'; data: unknown }
    | { kind: 'auto_approved'; proposalId: string; payload: unknown }
    | { kind: 'user_task'; proposalId: string }
    // The agent proposed nothing: terminal like `researcher`, never parked.
    | { kind: 'none_proposed'; proposalId: string; payload: unknown }
  >
}

function tryResolveAgentWorkflowBridge(
  container: AwilixContainer,
): AgentWorkflowBridgeLike | undefined {
  try {
    return container.resolve<AgentWorkflowBridgeLike>('agentWorkflowBridge')
  } catch {
    return undefined
  }
}

export async function executeInvokeAgent(
  config: unknown,
  context: ActivityContext,
  container: AwilixContainer
): Promise<any> {
  const parsed = invokeAgentConfigSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ')
    throw new Error(`INVOKE_AGENT config invalid: ${issues}`)
  }
  const { agentId, input, onResult, outputMapping, subject, review } = parsed.data

  // The Review section is resolved HERE, against the context the step ran with,
  // for the same reason a USER_TASK's assignment is resolved at creation rather
  // than at read time: a definition edit while the agent is running must not
  // retro-change who the resulting review task belongs to. `config` reaches this
  // function already interpolated, so a dynamic assignee is either a resolved id
  // or an untouched `{{…}}` token — which `resolveTaskAssignment` reads as the
  // fallback-to-the-role-queue case.
  const dispositionReview = toAgentDispositionReview(resolveAgentReview(review, (value) => value))

  // Fail fast when the optional agent_orchestrator peer is absent — the worker
  // would otherwise enqueue a job that can never run.
  const bridge = tryResolveAgentWorkflowBridge(container)
  if (!bridge) {
    throw new Error('[internal] agent_orchestrator not installed')
  }

  const stepId =
    context.stepContext?.stepId ||
    context.workflowInstance.currentStepId

  // Resolve the traceable principal this agent run executes as, from the
  // workflow instance (NOT the unreliable execution `context.userId`, which is
  // empty for event/sub-workflow paths). Same security model as CALL_API: the
  // run must never exceed the permissions of the human who triggered (or
  // authored) the workflow, and there is no anonymous "system" fallback —
  // passing an empty user id downstream both poisons the DB transaction
  // (invalid uuid `""`) and would mint a session token attributed to no one.
  const principalEm = container.resolve<PostgreSqlEntityManager>('em')
  const effectiveUserId = await resolveWorkflowPrincipalUserId(principalEm, context.workflowInstance)
  if (!effectiveUserId) {
    throw new Error(
      `[INVOKE_AGENT] Refusing to execute for workflow instance ${context.workflowInstance.id}: ` +
      `no traceable user (instance initiatedBy or definition author) could be resolved. ` +
      `Agent runs must execute under the identity of the user who triggered them.`
    )
  }

  // Parallel-branch agent steps keep the legacy inline path. The async fix below
  // parks and resumes at the INSTANCE level, and sendSignal's FORKED branch
  // resume only matches WAIT_FOR_SIGNAL steps — so an instance-level resume would
  // not reach a parked branch. The claims blueprints (and the common case) run
  // agents sequentially at the instance level; only rarely-used parallel branches
  // hit this fallback, where behavior is unchanged from before.
  if (context.branchInstanceId) {
    const outcome = await bridge.invokeAgentForWorkflow({
      agentId,
      input,
      onResult,
      ctx: {
        tenantId: context.workflowInstance.tenantId,
        organizationId: context.workflowInstance.organizationId,
        userId: effectiveUserId,
        processId: context.workflowInstance.id,
        stepId,
        ...(subject ? { subject } : {}),
        ...(dispositionReview ? { review: dispositionReview } : {}),
      },
    })
    if (outcome.kind === 'researcher') {
      return { kind: 'researcher', agentId, data: outcome.data }
    }
    if (outcome.kind === 'auto_approved' || outcome.kind === 'none_proposed') {
      return { kind: outcome.kind, agentId, proposalId: outcome.proposalId, proposalPayload: outcome.payload }
    }
    return {
      kind: 'user_task',
      agentId,
      proposalId: outcome.proposalId,
      __park: { signalName: INVOKE_AGENT_SIGNAL_NAME },
    }
  }

  if (!context.stepInstanceId) {
    throw new Error('[internal] INVOKE_AGENT requires a step instance to park on')
  }

  // Run the agent OUTSIDE the workflow transaction. Previously the agent ran
  // inline here, on the workflow's transactional EM: a failing statement aborted
  // the whole workflow transaction ("current transaction is aborted, …") and,
  // for cross-process OpenCode agents, the per-run api_key / session rows were
  // written into the still-open transaction so the separate mcp:serve-http
  // process could not see them to authenticate submit_outcome. Instead we enqueue
  // a dedicated job and PARK the step on the proposal-ready signal: the
  // workflow-invoke-agent worker runs the agent on its own connection (committed,
  // cross-process visible) and resumes the parked step via sendSignal. user_task
  // outcomes stay parked until agent_orchestrator's human dispose fires the same
  // signal — identical to the prior park behavior.
  const queue = getInvokeAgentQueue()
  const job: WorkflowActivityJobInvokeAgent = {
    kind: 'invoke_agent',
    workflowInstanceId: context.workflowInstance.id,
    branchInstanceId: context.branchInstanceId ?? undefined,
    stepInstanceId: context.stepInstanceId,
    stepId,
    signalName: INVOKE_AGENT_SIGNAL_NAME,
    agentId,
    input: (input ?? {}) as Record<string, any>,
    onResult,
    ...(outputMapping ? { outputMapping } : {}),
    ...(subject ? { subject } : {}),
    ...(dispositionReview ? { review: dispositionReview } : {}),
    tenantId: context.workflowInstance.tenantId,
    organizationId: context.workflowInstance.organizationId,
    userId: effectiveUserId,
  }
  const jobId = await queue.enqueue(job, { delayMs: INVOKE_AGENT_ENQUEUE_DELAY_MS })

  return {
    kind: 'pending_agent',
    agentId,
    jobId,
    __park: { signalName: INVOKE_AGENT_SIGNAL_NAME },
  }
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
  // 1. Interpolate variables in config (including {{workflow.*}}, {{context.*}}, allowlisted {{env.*}}, {{now}})
  const interpolatedConfig = interpolateActivityConfig(config, context, 'CALL_API')

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

  // 4. Create the one-time API key on an EntityManager that is fully detached
  //    from the surrounding request/transaction context.
  //
  //    CALL_API runs inside `workflowExecutor.executeWorkflow()`, which wraps
  //    the whole execution in `em.transactional(...)`. The request EM is forked
  //    with `useContext: true`, so while that transaction is open, EVERY
  //    operation on the container's `em` — including this API key's
  //    persist/flush — is transparently redirected to the uncommitted
  //    transaction fork (MikroORM `getContext()` → `TransactionContext`). The
  //    key would therefore stay invisible until the transaction commits, but
  //    the commit cannot happen until this activity returns. The outbound
  //    self-authenticated `fetch` below opens a SEPARATE DB connection that
  //    cannot see the uncommitted row, so the internal API responds `401` and
  //    the activity fails (issue #4202).
  //
  //    Forking with `useContext: false` (matching the query_index/webhooks
  //    isolated-EM convention) gives the key its own pooled connection with
  //    autocommit, so it is committed and visible to the internal request
  //    immediately.
  const apiKeyEm = container
    .resolve<PostgreSqlEntityManager>('em')
    .fork({ clear: true, freshEventManager: true, useContext: false }) as PostgreSqlEntityManager

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

/**
 * Loads the instance's definition (including soft-deleted rows, so an execution
 * grant on a deleted definition still binds a run that is still executing).
 */
async function loadInstanceDefinition(em: any, instance: CallApiInstanceLike) {
  if (!instance.definitionId) return null
  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  const { WorkflowDefinition } = await import('../data/entities')
  return findOneWithDecryption(
    em,
    WorkflowDefinition,
    { id: instance.definitionId, tenantId: instance.tenantId },
    {},
    { tenantId: instance.tenantId, organizationId: instance.organizationId },
  )
}

export async function resolveCallApiRoleIds(
  em: any,
  instance: CallApiInstanceLike
): Promise<string[]> {
  if (!instance.definitionId) return []

  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }
  const definition = await loadInstanceDefinition(em, instance)

  // 0. A definition that declares its own execution grant ALWAYS acts as its
  //    own least-privilege principal, whoever started the run — otherwise a
  //    CALL_API activity would mint a key carrying the starting admin's roles
  //    and route straight around the grant.
  if (definitionDeclaresGrant(definition)) {
    const principalUserId = await resolveWorkflowDefinitionExecutionUserId(em, definition, null)
    return principalUserId ? resolveActiveRoleIdsForUser(em, principalUserId, scope) : []
  }

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
  const authorUserId = definition?.deletedAt ? null : definition?.createdBy
  if (!authorUserId) return []

  return resolveActiveRoleIdsForUser(em, authorUserId, scope)
}

/**
 * Resolve the traceable principal user id an INVOKE_AGENT run executes as.
 *
 * Mirrors `resolveCallApiRoleIds`' principal chain so workflow-originated agent
 * runs carry the same audited identity as CALL_API:
 *   1. The instance's `metadata.initiatedBy` (whoever started it; inherited by
 *      sub-workflows from the parent instance).
 *   2. The definition's `createdBy` (author) for event-triggered instances with
 *      no human initiator. Soft-deleted definitions resolve to no principal.
 *
 * Both are outranked by the definition's own `grantedFeatures` execution
 * principal when it declares one (see `lib/definition-grant.ts`).
 *
 * Returns `null` when no traceable principal exists — callers MUST refuse rather
 * than fall back to an empty/anonymous user id (which breaks uuid columns and
 * bypasses RBAC attribution).
 */
export async function resolveWorkflowPrincipalUserId(
  em: any,
  instance: CallApiInstanceLike
): Promise<string | null> {
  const definition = await loadInstanceDefinition(em, instance)

  // 0. A declared execution grant outranks both — the run acts as its own
  //    principal regardless of who started it.
  if (definitionDeclaresGrant(definition)) {
    return resolveWorkflowDefinitionExecutionUserId(em, definition, null)
  }

  const initiatorUserId = instance.metadata?.initiatedBy ?? null
  if (initiatorUserId) return initiatorUserId

  if (definition?.deletedAt) return null
  return definition?.createdBy ?? null
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

type InterpolationBaseResolution =
  | { status: 'resolved'; value: unknown }
  | { status: 'unresolved-context'; contextPath: string }
  | { status: 'unknown-workflow-key'; workflowKey: string }
  | { status: 'env-not-allowlisted'; envKey: string }

function resolveInterpolationBaseValue(
  path: string,
  context: Record<string, any>,
  workflowInstance?: WorkflowInstance
): InterpolationBaseResolution {
  if (path.startsWith('workflow.') && workflowInstance) {
    const workflowKey = path.substring('workflow.'.length)
    switch (workflowKey) {
      case 'instanceId':
        return { status: 'resolved', value: workflowInstance.id }
      case 'tenantId':
        return { status: 'resolved', value: workflowInstance.tenantId }
      case 'organizationId':
        return { status: 'resolved', value: workflowInstance.organizationId }
      case 'currentStepId':
        return { status: 'resolved', value: workflowInstance.currentStepId }
      case 'workflowId':
        return { status: 'resolved', value: workflowInstance.workflowId }
      case 'version':
        return { status: 'resolved', value: workflowInstance.version }
      default:
        return { status: 'unknown-workflow-key', workflowKey }
    }
  }

  if (path.startsWith('env.')) {
    const envKey = path.substring('env.'.length)
    if (!getWorkflowEnvInterpolationAllowlist().has(envKey)) {
      return { status: 'env-not-allowlisted', envKey }
    }
    return { status: 'resolved', value: process.env[envKey] ?? '' }
  }

  if (path === 'now') {
    return { status: 'resolved', value: new Date().toISOString() }
  }

  const contextPath = path.startsWith('context.') ? path.substring('context.'.length) : path
  const value = getNestedValue(context, contextPath)
  if (value !== undefined) return { status: 'resolved', value }
  return { status: 'unresolved-context', contextPath }
}

function strictInterpolationError(rawToken: string, reason: string): WorkflowInterpolationError {
  return new WorkflowInterpolationError(
    `Cannot interpolate {{${rawToken}}}: ${reason}`,
    rawToken
  )
}

function interpolateToken(
  rawToken: string,
  context: Record<string, any>,
  workflowInstance: WorkflowInstance | undefined,
  strict: boolean
): { resolved: boolean; value?: unknown } {
  const parsedToken = parseInterpolationToken(rawToken)
  if (!parsedToken.ok) {
    if (strict) throw strictInterpolationError(rawToken, parsedToken.error)
    return { resolved: false }
  }
  const resolution = resolveInterpolationBaseValue(parsedToken.path, context, workflowInstance)
  if (resolution.status === 'unknown-workflow-key') {
    if (strict) throw strictInterpolationError(rawToken, `unknown workflow key "${resolution.workflowKey}"`)
    return { resolved: false }
  }
  if (resolution.status === 'env-not-allowlisted') {
    if (strict) throw strictInterpolationError(rawToken, `env variable "${resolution.envKey}" is not allowlisted`)
  }
  const baseValue =
    resolution.status === 'resolved'
      ? resolution.value
      : resolution.status === 'env-not-allowlisted'
        ? ''
        : undefined
  if (parsedToken.transforms.length === 0) {
    if (resolution.status === 'unresolved-context') {
      if (strict) throw strictInterpolationError(rawToken, `context path "${resolution.contextPath}" is not defined`)
      return { resolved: false }
    }
    return { resolved: true, value: baseValue }
  }
  const transformed = applyTransforms(baseValue, parsedToken.transforms)
  if (!transformed.ok) {
    if (strict) throw strictInterpolationError(rawToken, transformed.error.message)
    return { resolved: false }
  }
  if (transformed.value === undefined) {
    if (strict) throw strictInterpolationError(rawToken, 'the transform pipeline produced no value')
    return { resolved: false }
  }
  return { resolved: true, value: transformed.value }
}

/**
 * Interpolate variables in config from workflow context
 *
 * Supports syntax:
 * - {{context.field}} or {{context.nested.field}} - from workflow context
 * - {{workflow.instanceId}} - workflow instance ID
 * - {{workflow.tenantId}} - tenant ID
 * - {{workflow.organizationId}} - organization ID
 * - {{workflow.currentStepId}} - current step ID
 * - {{env.VAR_NAME}} - server-allowlisted environment variables
 * - {{now}} - current ISO timestamp
 * - {{ path | transform(args) | ... }} - pill transform pipeline
 *   (`lib/interpolation-pipeline.ts`): a fixed table of pure transforms folded
 *   over the resolved base value. Lenient behavior (the default): an
 *   unparseable token, an unresolved path without a rescuing `default`, or a
 *   failed transform passes the original token/config through unchanged. In
 *   strict mode (`options.mode: 'strict'`, opted in per definition) the same
 *   situations throw `WorkflowInterpolationError` naming the offending token;
 *   only a `default(...)` transform can rescue an unresolved context path.
 */
export function interpolateVariables(
  config: any,
  context: Record<string, any>,
  workflowInstance?: WorkflowInstance,
  options?: { mode?: WorkflowInterpolationMode }
): any {
  const strict = options?.mode === 'strict'
  if (typeof config === 'string') {
    // Check if this is a single variable reference (e.g., "{{context.cart.items}}")
    // This preserves the original type (array, object, number, boolean)
    const singleVarMatch = config.match(/^\{\{([^}]+)\}\}$/)

    if (singleVarMatch) {
      const outcome = interpolateToken(singleVarMatch[1], context, workflowInstance, strict)
      return outcome.resolved ? outcome.value : config
    }

    // Multiple interpolations or mixed text - return string
    return config.replace(/\{\{([^}]+)\}\}/g, (match, token) => {
      const outcome = interpolateToken(token, context, workflowInstance, strict)
      return outcome.resolved ? String(outcome.value) : match
    })
  }

  if (Array.isArray(config)) {
    return config.map((item) => interpolateVariables(item, context, workflowInstance, options))
  }

  if (config && typeof config === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(config)) {
      result[key] = interpolateVariables(value, context, workflowInstance, options)
    }
    return result
  }

  return config
}

function interpolateActivityConfig(
  config: any,
  context: ActivityContext,
  activityType: ActivityType,
  activityName?: string
): any {
  try {
    return interpolateVariables(config, context.workflowContext, context.workflowInstance, {
      mode: context.interpolationMode,
    })
  } catch (error) {
    if (error instanceof WorkflowInterpolationError) {
      throw new ActivityExecutionError(error.message, activityType, activityName, { token: error.token })
    }
    throw error
  }
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
  executor: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout
  const abortController = new AbortController()

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort()
      reject(new Error(`Activity execution timeout after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([executor(abortController.signal), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

bindActivityExecutor({
  executeSendEmail,
  executeEmitEvent,
  executeUpdateEntity,
  executeCallWebhook,
  executeFunction,
  executeCallApi,
  executeSetVariable,
  executeInvokeAgent,
})
