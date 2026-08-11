import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentPrincipal, AgentRun, AgentProcessDefinition, AgentProcessRun } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE } from '../lib/queue'
import { isAgentCapacityError } from '../lib/runtime/admission'
import { parseProcessTriggers, scheduleTriggers } from '../lib/tasks/triggers'
import type { AgentRunCtx, AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ worker: 'task-run-executor' })

/**
 * Process-run executor: consumes `{ processRunId }` jobs from the always-async
 * run pipeline and dispatches on the run's denormalized `targetType` —
 * `agentRuntime.run()` (the exact Playground call) or
 * `workflowExecutor.startWorkflow()` (the exact "Start instance" call).
 *
 * Also accepts the scheduler's `{ scheduledProcessDefinitionId, scheduleId }`
 * payload (the cron target enqueues straight onto this queue): that shape is
 * converted into a real AgentProcessRun via the enqueueRun command, which then
 * enqueues the normal `{ processRunId }` job.
 *
 * Idempotent per packages/queue/AGENTS.md: a retried job re-checks
 * `AgentProcessRun.status` and skips terminal rows. Tenant/org scope is
 * re-resolved from the row itself — never trusted from the payload.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_PROCESS_RUN_QUEUE,
  id: 'agent_orchestrator:task-run-executor',
  concurrency: 2,
}

type TaskRunJobPayload = {
  processRunId?: string
  scheduledProcessDefinitionId?: string
  scheduleId?: string
}

type RetryableError = { retryable?: boolean }

function isRetryable(error: unknown): boolean {
  return isAgentCapacityError(error) || (typeof error === 'object' && error !== null && (error as RetryableError).retryable === true)
}

/**
 * The human the run acts on behalf of — only a MANUAL entry has one. A schedule
 * or event entry has no delegator, so `runAs.onBehalfOfUserId` stays null and
 * the run is attributed purely to the definition's execution principal.
 */
function parseTriggeredByUser(triggeredBy: AgentProcessRun['triggeredBy']): string | null {
  if (!triggeredBy || triggeredBy.kind !== 'manual') return null
  return triggeredBy.ref ?? null
}

async function finishTaskRun(
  em: EntityManager,
  taskRun: AgentProcessRun,
  outcome: { status: 'completed' | 'failed'; agentRunId?: string | null; failureReason?: string | null },
): Promise<void> {
  taskRun.status = outcome.status
  if (outcome.agentRunId !== undefined) taskRun.agentRunId = outcome.agentRunId
  if (outcome.failureReason !== undefined) taskRun.failureReason = outcome.failureReason
  taskRun.completedAt = new Date()
  await em.flush()
  await emitAgentOrchestratorEvent(
    outcome.status === 'completed' ? 'agent_orchestrator.process_run.completed' : 'agent_orchestrator.process_run.failed',
    {
      id: taskRun.id,
      processDefinitionId: taskRun.processDefinitionId,
      targetType: taskRun.targetType,
      status: taskRun.status,
      tenantId: taskRun.tenantId,
      organizationId: taskRun.organizationId,
    },
    { persistent: true },
  )
}

/** Scheduler tick → create the real AgentProcessRun through the same command every trigger source uses. */
async function handleScheduledTick(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  payload: TaskRunJobPayload,
): Promise<void> {
  const definition = await em.findOne(AgentProcessDefinition, {
    id: payload.scheduledProcessDefinitionId,
    deletedAt: null,
  })
  if (!definition || !definition.enabled) return
  // The scheduler only holds registrations for enabled schedule triggers, but a
  // tick can outrace an edit that disabled the last one — re-read the declared
  // list rather than trusting the registration that produced this job.
  const schedules = scheduleTriggers(parseProcessTriggers(definition.triggers))
  if (!schedules.some((trigger) => trigger.enabled)) return
  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: definition.organizationId,
    organizationIds: [definition.organizationId],
  }
  try {
    await commandBus.execute('agent_orchestrator.processes.enqueueRun', {
      input: {
        tenantId: definition.tenantId,
        organizationId: definition.organizationId,
        processDefinitionId: definition.id,
        triggeredBy: { kind: 'schedule' as const, ref: payload.scheduleId ?? undefined },
      },
      ctx: commandCtx,
    })
  } catch (error) {
    logger.warn('scheduled task tick failed to enqueue', {
      processDefinitionId: definition.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The definition's own least-privilege execution principal — the acting identity for
 * BOTH target types. Resolved from the definition (never from the payload) and
 * org-scoped, so a foreign principal id can never be borrowed.
 */
async function resolveExecutionPrincipal(
  em: EntityManager,
  taskRun: AgentProcessRun,
  definition: AgentProcessDefinition,
): Promise<AgentPrincipal | null> {
  return em.findOne(AgentPrincipal, {
    id: definition.executionPrincipalId,
    organizationId: taskRun.organizationId,
    deletedAt: null,
  })
}

async function executeAgentTarget(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  taskRun: AgentProcessRun,
  definition: AgentProcessDefinition,
): Promise<void> {
  const principal = await resolveExecutionPrincipal(em, taskRun, definition)
  if (!principal) {
    await finishTaskRun(em, taskRun, { status: 'failed', failureReason: 'Execution principal missing' })
    return
  }
  if (!taskRun.targetAgentId) {
    await finishTaskRun(em, taskRun, { status: 'failed', failureReason: 'Task has no target agent' })
    return
  }

  const runCtx: AgentRunCtx = {
    tenantId: taskRun.tenantId,
    organizationId: taskRun.organizationId,
    // The definition's own principal is the acting identity — never the trigger.
    userId: principal.userId,
    runAs: {
      agentUserId: principal.userId,
      onBehalfOfUserId: parseTriggeredByUser(taskRun.triggeredBy),
    },
  }

  const startedBefore = new Date()
  try {
    const agentRuntime = container.resolve('agentRuntime') as AgentRuntimeService
    await agentRuntime.run(taskRun.targetAgentId, taskRun.input, runCtx)
  } catch (error) {
    if (isRetryable(error)) throw error
    const created = await em.find(
      AgentRun,
      { organizationId: taskRun.organizationId, agentId: taskRun.targetAgentId, createdAt: { $gte: startedBefore } },
      { orderBy: { createdAt: 'desc' }, limit: 1 },
    )
    await finishTaskRun(em, taskRun, {
      status: 'failed',
      agentRunId: created[0]?.id ?? null,
      failureReason: error instanceof Error ? error.message : 'Agent run failed',
    })
    return
  }

  // agentRuntime.run() returns the result, not the run id — correlate the same
  // way the trace-inspector re-run endpoint does (newest run for this agent
  // created during execution, org-scoped).
  const created = await em.find(
    AgentRun,
    { organizationId: taskRun.organizationId, agentId: taskRun.targetAgentId, createdAt: { $gte: startedBefore } },
    { orderBy: { createdAt: 'desc' }, limit: 1 },
  )
  await finishTaskRun(em, taskRun, { status: 'completed', agentRunId: created[0]?.id ?? null })
}

type WorkflowExecutorLike = {
  startWorkflow: (
    em: EntityManager,
    options: {
      workflowId: string
      initialContext?: Record<string, unknown>
      metadata?: { initiatedBy?: string }
      tenantId?: string
      organizationId?: string
    },
  ) => Promise<{ id: string }>
  executeWorkflow: (
    em: EntityManager,
    container: unknown,
    instanceId: string,
    context?: { userId?: string },
  ) => Promise<unknown>
}

async function executeWorkflowTarget(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  taskRun: AgentProcessRun,
  definition: AgentProcessDefinition,
): Promise<void> {
  if (!taskRun.targetWorkflowId) {
    await finishTaskRun(em, taskRun, { status: 'failed', failureReason: 'Task has no target workflow' })
    return
  }
  // The workflow target gets the SAME least-privilege identity the agent target
  // gets. Without it the run has no actor at all: `startWorkflow` recorded no
  // `metadata.initiatedBy` and `executeWorkflow` no `userId`, so every
  // UPDATE_ENTITY activity failed the "requires an authenticated workflow user"
  // check and CALL_API silently fell back to the workflow AUTHOR's roles —
  // which is exactly the trigger-borrows-a-bigger-identity path the definition's own
  // principal exists to close.
  const principal = await resolveExecutionPrincipal(em, taskRun, definition)
  if (!principal) {
    await finishTaskRun(em, taskRun, { status: 'failed', failureReason: 'Execution principal missing' })
    return
  }
  const workflowExecutor = container.resolve('workflowExecutor') as WorkflowExecutorLike

  let instanceId: string
  try {
    const instance = await workflowExecutor.startWorkflow(em, {
      workflowId: taskRun.targetWorkflowId,
      initialContext: (taskRun.input ?? {}) as Record<string, unknown>,
      metadata: { initiatedBy: principal.userId },
      tenantId: taskRun.tenantId,
      organizationId: taskRun.organizationId,
    })
    instanceId = instance.id
  } catch (error) {
    await finishTaskRun(em, taskRun, {
      status: 'failed',
      failureReason: error instanceof Error ? error.message : 'Workflow start failed',
    })
    return
  }

  // The ledger stays 'running' until the workflows.instance.completed/failed
  // subscriber resolves it — the instance may park at USER_TASK for days.
  taskRun.workflowInstanceId = instanceId
  await em.flush()

  try {
    await workflowExecutor.executeWorkflow(em, container, instanceId, { userId: principal.userId })
  } catch (error) {
    // The executor persists instance failure itself and (post lifecycle-events
    // spec) emits workflows.instance.failed — the subscriber owns the flip.
    logger.warn('workflow-target execution error (instance state is authoritative)', {
      processRunId: taskRun.id,
      instanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export default async function handle(job: QueuedJob<TaskRunJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = job.payload ?? {}
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  if (!payload.processRunId && payload.scheduledProcessDefinitionId) {
    await handleScheduledTick(container, em, payload)
    return
  }
  if (!payload.processRunId) return

  const taskRun = await em.findOne(AgentProcessRun, { id: payload.processRunId })
  if (!taskRun) return
  if (taskRun.status !== 'running') return
  // A workflow-target row with an instance already started must not start a
  // second instance on queue retry — the subscriber owns its resolution.
  if (taskRun.workflowInstanceId) return

  const scope = { tenantId: taskRun.tenantId, organizationId: taskRun.organizationId }
  const decrypted = await findOneWithDecryption(em, AgentProcessRun, { id: taskRun.id, ...scope }, undefined, scope)
  if (!decrypted) return

  const definition = await em.findOne(AgentProcessDefinition, { id: taskRun.processDefinitionId, ...scope })
  if (!definition) {
    await finishTaskRun(em, decrypted, { status: 'failed', failureReason: 'Task definition missing' })
    return
  }

  if (decrypted.targetType === 'agent') {
    await executeAgentTarget(container, em, decrypted, definition)
    return
  }
  if (decrypted.targetType === 'workflow') {
    await executeWorkflowTarget(container, em, decrypted, definition)
    return
  }
  await finishTaskRun(em, decrypted, { status: 'failed', failureReason: 'Unknown target type' })
}
