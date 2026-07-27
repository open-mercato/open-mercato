import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentPrincipal, AgentRun, AgentTaskDefinition, AgentTaskRun } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_TASK_RUN_QUEUE } from '../lib/queue'
import { isAgentCapacityError } from '../lib/runtime/admission'
import type { AgentRunCtx, AgentRuntimeService } from '../lib/runtime/agentRuntime'

/**
 * Agentic Tasks executor: consumes `{ taskRunId }` jobs from the always-async
 * run pipeline and dispatches on the run's denormalized `targetType` —
 * `agentRuntime.run()` (the exact Playground call) or
 * `workflowExecutor.startWorkflow()` (the exact "Start instance" call).
 *
 * Also accepts the scheduler's `{ scheduledTaskDefinitionId, scheduleId }`
 * payload (the cron target enqueues straight onto this queue): that shape is
 * converted into a real AgentTaskRun via the enqueueRun command, which then
 * enqueues the normal `{ taskRunId }` job.
 *
 * Idempotent per packages/queue/AGENTS.md: a retried job re-checks
 * `AgentTaskRun.status` and skips terminal rows. Tenant/org scope is
 * re-resolved from the row itself — never trusted from the payload.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_TASK_RUN_QUEUE,
  id: 'agent_orchestrator:task-run-executor',
  concurrency: 2,
}

type TaskRunJobPayload = {
  taskRunId?: string
  scheduledTaskDefinitionId?: string
  scheduleId?: string
}

type RetryableError = { retryable?: boolean }

function isRetryable(error: unknown): boolean {
  return isAgentCapacityError(error) || (typeof error === 'object' && error !== null && (error as RetryableError).retryable === true)
}

function parseTriggeredByUser(triggeredBy: string): string | null {
  return triggeredBy.startsWith('user:') ? triggeredBy.slice('user:'.length) : null
}

async function finishTaskRun(
  em: EntityManager,
  taskRun: AgentTaskRun,
  outcome: { status: 'completed' | 'failed'; agentRunId?: string | null; failureReason?: string | null },
): Promise<void> {
  taskRun.status = outcome.status
  if (outcome.agentRunId !== undefined) taskRun.agentRunId = outcome.agentRunId
  if (outcome.failureReason !== undefined) taskRun.failureReason = outcome.failureReason
  taskRun.completedAt = new Date()
  await em.flush()
  await emitAgentOrchestratorEvent(
    outcome.status === 'completed' ? 'agent_orchestrator.task_run.completed' : 'agent_orchestrator.task_run.failed',
    {
      id: taskRun.id,
      taskDefinitionId: taskRun.taskDefinitionId,
      targetType: taskRun.targetType,
      status: taskRun.status,
      tenantId: taskRun.tenantId,
      organizationId: taskRun.organizationId,
    },
    { persistent: true },
  )
}

/** Scheduler tick → create the real AgentTaskRun through the same command every trigger source uses. */
async function handleScheduledTick(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  payload: TaskRunJobPayload,
): Promise<void> {
  const definition = await em.findOne(AgentTaskDefinition, {
    id: payload.scheduledTaskDefinitionId,
    deletedAt: null,
  })
  if (!definition || !definition.enabled || !definition.scheduleEnabled) return
  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: definition.organizationId,
    organizationIds: [definition.organizationId],
  }
  try {
    await commandBus.execute('agent_orchestrator.tasks.enqueueRun', {
      input: {
        tenantId: definition.tenantId,
        organizationId: definition.organizationId,
        taskDefinitionId: definition.id,
        triggeredBy: `schedule:${payload.scheduleId ?? 'cron'}`,
      },
      ctx: commandCtx,
    })
  } catch (error) {
    console.warn(
      '[internal] agent_orchestrator: scheduled task tick failed to enqueue',
      { taskDefinitionId: definition.id },
      error instanceof Error ? error.message : error,
    )
  }
}

async function executeAgentTarget(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  taskRun: AgentTaskRun,
  definition: AgentTaskDefinition,
): Promise<void> {
  const principal = await em.findOne(AgentPrincipal, {
    id: definition.executionPrincipalId,
    organizationId: taskRun.organizationId,
    deletedAt: null,
  })
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
    // The task's own principal is the acting identity — never the trigger.
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
      tenantId?: string
      organizationId?: string
    },
  ) => Promise<{ id: string }>
  executeWorkflow: (em: EntityManager, container: unknown, instanceId: string) => Promise<unknown>
}

async function executeWorkflowTarget(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  taskRun: AgentTaskRun,
): Promise<void> {
  if (!taskRun.targetWorkflowId) {
    await finishTaskRun(em, taskRun, { status: 'failed', failureReason: 'Task has no target workflow' })
    return
  }
  const workflowExecutor = container.resolve('workflowExecutor') as WorkflowExecutorLike

  let instanceId: string
  try {
    const instance = await workflowExecutor.startWorkflow(em, {
      workflowId: taskRun.targetWorkflowId,
      initialContext: (taskRun.input ?? {}) as Record<string, unknown>,
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
    await workflowExecutor.executeWorkflow(em, container, instanceId)
  } catch (error) {
    // The executor persists instance failure itself and (post lifecycle-events
    // spec) emits workflows.instance.failed — the subscriber owns the flip.
    console.warn(
      '[internal] agent_orchestrator: workflow-target execution error (instance state is authoritative)',
      { taskRunId: taskRun.id, instanceId },
      error instanceof Error ? error.message : error,
    )
  }
}

export default async function handle(job: QueuedJob<TaskRunJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = job.payload ?? {}
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  if (!payload.taskRunId && payload.scheduledTaskDefinitionId) {
    await handleScheduledTick(container, em, payload)
    return
  }
  if (!payload.taskRunId) return

  const taskRun = await em.findOne(AgentTaskRun, { id: payload.taskRunId })
  if (!taskRun) return
  if (taskRun.status !== 'running') return
  // A workflow-target row with an instance already started must not start a
  // second instance on queue retry — the subscriber owns its resolution.
  if (taskRun.workflowInstanceId) return

  const scope = { tenantId: taskRun.tenantId, organizationId: taskRun.organizationId }
  const decrypted = await findOneWithDecryption(em, AgentTaskRun, { id: taskRun.id, ...scope }, undefined, scope)
  if (!decrypted) return

  const definition = await em.findOne(AgentTaskDefinition, { id: taskRun.taskDefinitionId, ...scope })
  if (!definition) {
    await finishTaskRun(em, decrypted, { status: 'failed', failureReason: 'Task definition missing' })
    return
  }

  if (decrypted.targetType === 'agent') {
    await executeAgentTarget(container, em, decrypted, definition)
    return
  }
  if (decrypted.targetType === 'workflow') {
    await executeWorkflowTarget(container, em, decrypted)
    return
  }
  await finishTaskRun(em, decrypted, { status: 'failed', failureReason: 'Unknown target type' })
}
