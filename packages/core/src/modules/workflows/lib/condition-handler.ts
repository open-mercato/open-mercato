/**
 * Condition Handler Service
 *
 * Drives WAIT_FOR_CONDITION steps: a step that pauses a workflow (or a single
 * parallel branch) until a boolean predicate over the run context holds.
 *
 * Two paths resume a waiter:
 *  - `wakeConditionWaiters` — the event-driven fast path, called by the scoped
 *    context-write endpoint right after a patch is merged.
 *  - `evaluateWaitCondition` — the durability backstop, dispatched by the
 *    activity worker from a delayed `kind: 'condition'` queue job. It also
 *    owns timeout enforcement, so a wait can never hang forever.
 *
 * The predicate reuses the business_rules ConditionExpression language and
 * `ruleEvaluator.evaluateConditions` — the same evaluator that backs transition
 * conditions — so there is no second expression dialect.
 */

import { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import * as ruleEvaluator from '../../business_rules/lib/rule-evaluator'
import {
  WorkflowInstance,
  WorkflowDefinition,
  WorkflowBranchInstance,
  StepInstance,
} from '../data/entities'
import { parseDuration } from './duration'
import { resolveCodeDefinitionForInstance } from './find-definition'
import { branchToken, rootToken, tokenReadContext } from './execution-token'
import type * as eventLoggerModule from './event-logger'
import type * as stepHandlerModule from './step-handler'
import type * as transitionHandlerModule from './transition-handler'
import type * as workflowExecutorModule from './workflow-executor'

export const CONDITION_STEP_TYPE = 'WAIT_FOR_CONDITION'

export const DEFAULT_CONDITION_POLL_INTERVAL_MS = 30_000
export const MIN_CONDITION_POLL_INTERVAL_MS = 5_000
export const MAX_CONDITION_POLL_INTERVAL_MS = 3_600_000
export const DEFAULT_MAX_CONDITION_ATTEMPTS = 1000

export class ConditionWaitError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ConditionWaitError'
  }
}

export type ConditionTimeoutBehaviour = 'FAIL' | 'CONTINUE'

export interface WaitForConditionConfig {
  condition: unknown
  timeout: string
  timeoutMs: number
  onTimeout: ConditionTimeoutBehaviour
  pollIntervalMs: number
}

export type ConditionWokenBy = 'immediate' | 'poll' | 'context-write'

export interface EvaluateWaitConditionOptions {
  instanceId: string
  stepInstanceId: string
  branchInstanceId?: string | null
  deadlineAt: string
  attempt: number
  userId?: string
  tenantId: string
  organizationId: string
}

export type WaitConditionOutcome = 'met' | 'pending' | 'timed_out' | 'noop'

export interface WaitConditionEvaluationResult {
  outcome: WaitConditionOutcome
  reason?: string
}

export interface WakeConditionWaitersOptions {
  instanceId: string
  tenantId: string
  organizationId: string
  userId?: string
}

export interface WakeConditionWaitersResult {
  woken: string[]
}

/**
 * Hard cap on poll re-enqueues, so a never-satisfiable predicate cannot
 * saturate the queue even if the deadline arithmetic is somehow skewed.
 */
export function resolveMaxConditionAttempts(): number {
  const raw = process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS
  if (!raw) return DEFAULT_MAX_CONDITION_ATTEMPTS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CONDITION_ATTEMPTS
  return parsed
}

/**
 * Read and normalise a WAIT_FOR_CONDITION step's config. Fails closed: the
 * predicate and the timeout are both mandatory, and the poll interval is
 * clamped into its supported range and never allowed past the deadline.
 */
export function readWaitForConditionConfig(stepDef: unknown): WaitForConditionConfig {
  const step = (stepDef ?? {}) as { stepId?: string; config?: Record<string, unknown> | null }
  const config = (step.config ?? {}) as Record<string, unknown>

  const condition = config.condition
  if (condition == null) {
    throw new ConditionWaitError(
      'WAIT_FOR_CONDITION requires a "condition" expression',
      'CONDITION_CONFIG_MISSING',
      { stepId: step.stepId }
    )
  }

  const timeout = config.timeout
  if (typeof timeout !== 'string' || timeout.length === 0) {
    throw new ConditionWaitError(
      'WAIT_FOR_CONDITION requires a "timeout" ISO 8601 duration',
      'CONDITION_TIMEOUT_MISSING',
      { stepId: step.stepId }
    )
  }

  let timeoutMs: number
  try {
    timeoutMs = parseDuration(timeout)
  } catch {
    throw new ConditionWaitError(
      `WAIT_FOR_CONDITION invalid "timeout" duration: ${timeout}`,
      'CONDITION_TIMEOUT_INVALID',
      { stepId: step.stepId, timeout }
    )
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConditionWaitError(
      `WAIT_FOR_CONDITION "timeout" must be a positive duration: ${timeout}`,
      'CONDITION_TIMEOUT_INVALID',
      { stepId: step.stepId, timeout }
    )
  }

  const onTimeout: ConditionTimeoutBehaviour = config.onTimeout === 'CONTINUE' ? 'CONTINUE' : 'FAIL'

  const rawPollInterval =
    typeof config.pollIntervalMs === 'number' && Number.isFinite(config.pollIntervalMs)
      ? config.pollIntervalMs
      : DEFAULT_CONDITION_POLL_INTERVAL_MS
  const clampedPollInterval = Math.min(
    Math.max(rawPollInterval, MIN_CONDITION_POLL_INTERVAL_MS),
    MAX_CONDITION_POLL_INTERVAL_MS
  )

  return {
    condition,
    timeout,
    timeoutMs,
    onTimeout,
    pollIntervalMs: Math.min(clampedPollInterval, timeoutMs),
  }
}

/**
 * Evaluate a wait predicate against a read context. Shared by the step handler
 * (entry evaluation) and both resume paths, so all three agree on semantics.
 */
export async function evaluateConditionExpression(params: {
  condition: unknown
  data: Record<string, unknown>
  instanceId: string
  userId?: string
}): Promise<boolean> {
  const evaluationContext: ruleEvaluator.RuleEvaluationContext = {
    entityType: 'workflow:wait_condition',
    entityId: params.instanceId,
    user: params.userId ? { id: params.userId } : undefined,
  }
  return await ruleEvaluator.evaluateConditions(params.condition, params.data, evaluationContext)
}

/** Read context a waiter's predicate sees — instance context, branch overlay included. */
export function conditionReadContext(
  instance: WorkflowInstance,
  branch: WorkflowBranchInstance | null
): Record<string, unknown> {
  const token = branch ? branchToken(instance, branch) : rootToken(instance)
  return tokenReadContext(token)
}

async function loadDefinitionForInstance(
  em: EntityManager,
  instance: WorkflowInstance
): Promise<WorkflowDefinition | null> {
  const stored = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowDefinition,
    {
      id: instance.definitionId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: instance.tenantId, organizationId: instance.organizationId }
  )
  return stored ?? resolveCodeDefinitionForInstance(instance)
}

function findStepDefinition(definition: WorkflowDefinition, stepId: string): Record<string, unknown> | null {
  const steps = (definition.definition?.steps ?? []) as Array<Record<string, unknown>>
  return steps.find((step) => step.stepId === stepId) ?? null
}

function waitedMsSince(stepInstance: StepInstance, now: number): number {
  const enteredAt = stepInstance.enteredAt ? stepInstance.enteredAt.getTime() : now
  return Math.max(0, now - enteredAt)
}

interface ResolvedWaiter {
  stepInstance: StepInstance
  branch: WorkflowBranchInstance | null
  stepDef: Record<string, unknown>
  config: WaitForConditionConfig
}

async function loadBranch(
  em: EntityManager,
  instance: WorkflowInstance,
  branchInstanceId: string
): Promise<WorkflowBranchInstance | null> {
  return await em.findOne(WorkflowBranchInstance, {
    id: branchInstanceId,
    workflowInstanceId: instance.id,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })
}

/**
 * Exit a satisfied (or CONTINUE-on-timeout) waiter and drive the workflow on.
 * Branch waiters take the `resumeBranch` path so sibling branches are untouched.
 */
async function completeConditionWait(
  em: EntityManager,
  container: AwilixContainer,
  params: {
    instance: WorkflowInstance
    definition: WorkflowDefinition
    stepInstance: StepInstance
    branch: WorkflowBranchInstance | null
    attempts: number
    waitedMs: number
    wokenBy: ConditionWokenBy
    timedOut: boolean
    userId?: string
  }
): Promise<void> {
  const { instance, definition, stepInstance, branch, attempts, waitedMs, wokenBy, timedOut, userId } = params

  const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
  const stepHandler = container.resolve<typeof stepHandlerModule>('stepHandler')
  const transitionHandler = container.resolve<typeof transitionHandlerModule>('transitionHandler')
  const workflowExecutor = container.resolve<typeof workflowExecutorModule>('workflowExecutor')

  const outputData: Record<string, unknown> = {
    stepType: CONDITION_STEP_TYPE,
    conditionMet: !timedOut,
    attempts,
    waitedMs,
    wokenBy,
  }
  if (timedOut) outputData.timedOut = true

  if (!timedOut) {
    await eventLogger.logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      ...(branch ? { branchInstanceId: branch.id } : {}),
      eventType: 'CONDITION_MET',
      eventData: { stepId: stepInstance.stepId, attempts, waitedMs, wokenBy },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })
  }

  if (branch) {
    const { resumeBranch } = await import('./parallel-handler')
    const resumed = await resumeBranch(em, {
      instanceId: instance.id,
      branchInstanceId: branch.id,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
      exitStepInstanceId: stepInstance.id,
      exitOutput: outputData,
    })
    if (resumed) {
      await workflowExecutor.executeWorkflow(em, container, instance.id, { userId })
    }
    return
  }

  await stepHandler.exitStep(em, stepInstance, outputData)

  const autoTransitions = ((definition.definition?.transitions ?? []) as Array<Record<string, unknown>>).filter(
    (transition) => transition.fromStepId === stepInstance.stepId && transition.trigger === 'auto'
  )

  if (autoTransitions.length === 0) {
    instance.status = 'RUNNING'
    instance.updatedAt = new Date()
    await em.flush()
    return
  }

  const transitionContext = { workflowContext: instance.context, userId }

  const validTransitions = await transitionHandler.findValidTransitions(
    em,
    instance,
    stepInstance.stepId,
    transitionContext
  )
  const firstValidTransition = validTransitions.find((candidate) => candidate.isValid)

  if (!firstValidTransition || !firstValidTransition.transition) {
    instance.status = 'RUNNING'
    instance.updatedAt = new Date()
    await em.flush()
    return
  }

  const transitionResult = await transitionHandler.executeTransition(
    em,
    container,
    instance,
    stepInstance.stepId,
    firstValidTransition.transition.toStepId,
    { ...transitionContext, transitionId: firstValidTransition.transition.transitionId },
  )

  if (!transitionResult.success) {
    throw new ConditionWaitError(
      'Transition failed after condition was met',
      'TRANSITION_FAILED',
      { error: transitionResult.error }
    )
  }

  await workflowExecutor.executeWorkflow(em, container, instance.id, { userId })
}

/** Timeout with `onTimeout: 'FAIL'` — fail the step and take the normal compensation path. */
async function failConditionWait(
  em: EntityManager,
  container: AwilixContainer,
  params: {
    instance: WorkflowInstance
    stepInstance: StepInstance
    branch: WorkflowBranchInstance | null
    attempts: number
    waitedMs: number
    userId?: string
  }
): Promise<void> {
  const { instance, stepInstance, branch, attempts, waitedMs, userId } = params

  const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
  const workflowExecutor = container.resolve<typeof workflowExecutorModule>('workflowExecutor')

  const errorMessage = `WAIT_FOR_CONDITION timed out after ${waitedMs}ms without the condition becoming true`
  const now = new Date()

  stepInstance.status = 'FAILED'
  stepInstance.errorData = { error: errorMessage, attempts, waitedMs }
  stepInstance.exitedAt = now
  stepInstance.updatedAt = now
  if (branch) {
    branch.status = 'FAILED'
    branch.updatedAt = now
  }
  await em.flush()

  await eventLogger.logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(branch ? { branchInstanceId: branch.id } : {}),
    eventType: 'STEP_FAILED',
    eventData: { stepId: stepInstance.stepId, error: errorMessage },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  await workflowExecutor.completeWorkflow(em, container, instance.id, 'FAILED', { error: errorMessage })
}

async function resolveWaiter(
  em: EntityManager,
  instance: WorkflowInstance,
  definition: WorkflowDefinition,
  stepInstance: StepInstance
): Promise<ResolvedWaiter | null> {
  if (stepInstance.status !== 'ACTIVE') return null
  if (stepInstance.stepType !== CONDITION_STEP_TYPE) return null

  const branch = stepInstance.branchInstanceId
    ? await loadBranch(em, instance, stepInstance.branchInstanceId)
    : null

  if (stepInstance.branchInstanceId) {
    if (!branch || branch.status !== 'PAUSED') return null
  } else if (instance.status !== 'PAUSED') {
    return null
  }

  const stepDef = findStepDefinition(definition, stepInstance.stepId)
  if (!stepDef || stepDef.stepType !== CONDITION_STEP_TYPE) return null

  return { stepInstance, branch, stepDef, config: readWaitForConditionConfig(stepDef) }
}

/**
 * Backstop poll tick for one parked waiter. Mirrors `timerHandler.fireTimer`,
 * but is a no-op (never an error) when the event-driven path already resumed
 * the instance — a redelivered or superseded job must not fail the queue.
 */
export async function evaluateWaitCondition(
  em: EntityManager,
  container: AwilixContainer,
  options: EvaluateWaitConditionOptions
): Promise<WaitConditionEvaluationResult> {
  const { instanceId, stepInstanceId, tenantId, organizationId, userId } = options

  const instance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    { id: instanceId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId }
  )
  if (!instance) return { outcome: 'noop', reason: 'INSTANCE_NOT_FOUND' }

  const stepInstance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    StepInstance,
    { id: stepInstanceId, workflowInstanceId: instance.id, tenantId, organizationId },
    undefined,
    { tenantId, organizationId }
  )
  if (!stepInstance) return { outcome: 'noop', reason: 'STEP_INSTANCE_NOT_FOUND' }

  const definition = await loadDefinitionForInstance(em, instance)
  if (!definition) {
    throw new ConditionWaitError('Workflow definition not found', 'DEFINITION_NOT_FOUND', {
      definitionId: instance.definitionId,
    })
  }

  const waiter = await resolveWaiter(em, instance, definition, stepInstance)
  if (!waiter) return { outcome: 'noop', reason: 'NOT_WAITING_FOR_CONDITION' }

  const nowMs = Date.now()
  const waitedMs = waitedMsSince(stepInstance, nowMs)
  const attempts = Math.max(1, options.attempt)

  const met = await evaluateConditionExpression({
    condition: waiter.config.condition,
    data: conditionReadContext(instance, waiter.branch),
    instanceId: instance.id,
    userId,
  })

  if (met) {
    await completeConditionWait(em, container, {
      instance,
      definition,
      stepInstance,
      branch: waiter.branch,
      attempts,
      waitedMs,
      wokenBy: 'poll',
      timedOut: false,
      userId,
    })
    return { outcome: 'met' }
  }

  const deadlineMs = Date.parse(options.deadlineAt)
  const deadlinePassed = Number.isFinite(deadlineMs) ? nowMs >= deadlineMs : true
  const attemptCapReached = attempts >= resolveMaxConditionAttempts()

  if (deadlinePassed || attemptCapReached) {
    const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
    await eventLogger.logWorkflowEvent(em, {
      workflowInstanceId: instance.id,
      stepInstanceId: stepInstance.id,
      ...(waiter.branch ? { branchInstanceId: waiter.branch.id } : {}),
      eventType: 'CONDITION_TIMED_OUT',
      eventData: {
        stepId: stepInstance.stepId,
        attempts,
        waitedMs,
        onTimeout: waiter.config.onTimeout,
        attemptCapReached,
      },
      userId,
      tenantId: instance.tenantId,
      organizationId: instance.organizationId,
    })

    if (waiter.config.onTimeout === 'CONTINUE') {
      await completeConditionWait(em, container, {
        instance,
        definition,
        stepInstance,
        branch: waiter.branch,
        attempts,
        waitedMs,
        wokenBy: 'poll',
        timedOut: true,
        userId,
      })
    } else {
      await failConditionWait(em, container, {
        instance,
        stepInstance,
        branch: waiter.branch,
        attempts,
        waitedMs,
        userId,
      })
    }
    return { outcome: 'timed_out' }
  }

  // Re-enqueue at min(pollInterval, remaining). `deadlineAt` is forwarded
  // verbatim, so a slow queue cannot extend the configured wait.
  const delayMs = Math.max(1, Math.min(waiter.config.pollIntervalMs, deadlineMs - nowMs))
  const { enqueueConditionCheckJob } = await import('./activity-executor')
  const jobId = await enqueueConditionCheckJob({
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    branchInstanceId: waiter.branch ? waiter.branch.id : undefined,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    userId,
    deadlineAt: options.deadlineAt,
    attempt: attempts + 1,
    delayMs,
  })

  const eventLogger = container.resolve<typeof eventLoggerModule>('eventLogger')
  await eventLogger.logWorkflowEvent(em, {
    workflowInstanceId: instance.id,
    stepInstanceId: stepInstance.id,
    ...(waiter.branch ? { branchInstanceId: waiter.branch.id } : {}),
    eventType: 'CONDITION_EVALUATED',
    eventData: {
      stepId: stepInstance.stepId,
      met: false,
      attempt: attempts,
      nextCheckAt: new Date(nowMs + delayMs).toISOString(),
      jobId,
    },
    userId,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  })

  return { outcome: 'pending' }
}

/**
 * Event-driven wake: re-evaluate every waiter parked in this instance and
 * resume the ones whose predicate now holds. A miss is a silent no-op — the
 * pending poll job still stands, and logging misses here would flood the
 * timeline with one row per unrelated context write.
 */
export async function wakeConditionWaiters(
  em: EntityManager,
  container: AwilixContainer,
  options: WakeConditionWaitersOptions
): Promise<WakeConditionWaitersResult> {
  const { instanceId, tenantId, organizationId, userId } = options

  const instance = await findOneWithDecryption(
    em as PostgreSqlEntityManager,
    WorkflowInstance,
    { id: instanceId, tenantId, organizationId },
    undefined,
    { tenantId, organizationId }
  )
  if (!instance) return { woken: [] }
  if (instance.status !== 'RUNNING' && instance.status !== 'PAUSED' && instance.status !== 'FORKED') {
    return { woken: [] }
  }

  const stepInstances = await findWithDecryption(
    em as PostgreSqlEntityManager,
    StepInstance,
    {
      workflowInstanceId: instance.id,
      stepType: CONDITION_STEP_TYPE,
      status: 'ACTIVE',
      tenantId,
      organizationId,
    },
    undefined,
    { tenantId, organizationId }
  )
  if (stepInstances.length === 0) return { woken: [] }

  const definition = await loadDefinitionForInstance(em, instance)
  if (!definition) return { woken: [] }

  const woken: string[] = []

  for (const stepInstance of stepInstances) {
    const waiter = await resolveWaiter(em, instance, definition, stepInstance)
    if (!waiter) continue

    const met = await evaluateConditionExpression({
      condition: waiter.config.condition,
      data: conditionReadContext(instance, waiter.branch),
      instanceId: instance.id,
      userId,
    })
    if (!met) continue

    const nowMs = Date.now()
    await completeConditionWait(em, container, {
      instance,
      definition,
      stepInstance,
      branch: waiter.branch,
      attempts: 1,
      waitedMs: waitedMsSince(stepInstance, nowMs),
      wokenBy: 'context-write',
      timedOut: false,
      userId,
    })
    woken.push(stepInstance.stepId)
  }

  return { woken }
}
