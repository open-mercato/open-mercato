import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProcessDefinition, ProcessInstance } from '../data/entities'
import { emitAgentOrchestratorEvent } from '../events'
import { AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE } from '../lib/queue'
import { parseProcessTriggers, scheduleTriggers } from '../lib/tasks/triggers'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('agent_orchestrator').child({ worker: 'process-execution-starter' })

/**
 * Starts the ONE durable execution a business process has: its `WorkflowInstance`.
 *
 * There is deliberately no second branch here. The predecessor worker dispatched
 * on a `targetType` — running an agent straight from the queue for "simple"
 * processes — which meant those processes silently gave up retry, waits, signals,
 * cancellation and recovery, and left the run correlated to nothing but a
 * timestamp. A single-agent process now materializes a real
 * `START → INVOKE_AGENT → END` workflow, so this worker starts a workflow and
 * nothing else.
 *
 * The execution's own status is never written here either: `ProcessInstance` is a
 * projection, and the workflow instance is the lifecycle owner. This worker only
 * stamps which instance the execution became, and marks the row failed when no
 * instance could be started at all.
 *
 * Also accepts the scheduler's `{ scheduledProcessDefinitionId, scheduleId }`
 * payload (the cron target enqueues straight onto this queue): that shape is
 * converted into a real execution via the start command, which then enqueues the
 * normal `{ executionId }` job.
 *
 * Idempotent per packages/queue/AGENTS.md: a retried job re-checks the row and
 * skips one that already has an instance. Tenant/org scope is re-resolved from
 * the row itself — never trusted from the payload.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_PROCESS_EXECUTION_QUEUE,
  id: 'agent_orchestrator:process-execution-starter',
  concurrency: 2,
}

type ProcessExecutionJobPayload = {
  executionId?: string
  scheduledProcessDefinitionId?: string
  scheduleId?: string
}

/**
 * The human the execution acts on behalf of — only a MANUAL entry has one. A
 * schedule or event entry has no delegator, so the workflow runs purely under its
 * own execution principal with no on-behalf-of attribution.
 */
function parseTriggeredByUser(triggeredBy: ProcessInstance['triggeredBy']): string | null {
  if (!triggeredBy || triggeredBy.kind !== 'manual') return null
  return triggeredBy.ref ?? null
}

/**
 * Terminal failure BEFORE any workflow instance exists — the only status this
 * worker may write. Once an instance exists the instance owns the lifecycle and
 * the workflow-lifecycle subscribers own the projection.
 */
async function failBeforeStart(
  em: EntityManager,
  execution: ProcessInstance,
  failureReason: string,
): Promise<void> {
  execution.status = 'failed'
  execution.failureReason = failureReason
  execution.completedAt = new Date()
  execution.lastActivityAt = new Date()
  await em.flush()
  await emitAgentOrchestratorEvent(
    'agent_orchestrator.process.execution.failed',
    {
      id: execution.id,
      processDefinitionId: execution.processDefinitionId,
      workflowId: execution.workflowId,
      status: execution.status,
      tenantId: execution.tenantId,
      organizationId: execution.organizationId,
    },
    { persistent: true },
  )
}

/** Scheduler tick → create the real execution through the same command every trigger source uses. */
async function handleScheduledTick(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  em: EntityManager,
  payload: ProcessExecutionJobPayload,
): Promise<void> {
  const definition = await em.findOne(ProcessDefinition, {
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
    await commandBus.execute('agent_orchestrator.processes.startExecution', {
      input: {
        tenantId: definition.tenantId,
        organizationId: definition.organizationId,
        processDefinitionId: definition.id,
        triggeredBy: { kind: 'schedule' as const, ref: payload.scheduleId ?? undefined },
      },
      ctx: commandCtx,
    })
  } catch (error) {
    logger.warn('scheduled process tick failed to start', {
      processDefinitionId: definition.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

type WorkflowExecutorLike = {
  startWorkflow: (
    em: EntityManager,
    options: {
      workflowId: string
      initialContext?: Record<string, unknown>
      correlationKey?: string
      metadata?: { initiatedBy?: string }
      tenantId?: string
      organizationId?: string
    },
  ) => Promise<{ id: string; workflowId?: string; version?: number }>
  executeWorkflow: (
    em: EntityManager,
    container: unknown,
    instanceId: string,
    context?: { userId?: string },
  ) => Promise<unknown>
}

export default async function handle(job: QueuedJob<ProcessExecutionJobPayload>, _ctx: JobContext): Promise<void> {
  const payload = job.payload ?? {}
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  if (!payload.executionId && payload.scheduledProcessDefinitionId) {
    await handleScheduledTick(container, em, payload)
    return
  }
  if (!payload.executionId) return

  const execution = await em.findOne(ProcessInstance, { id: payload.executionId })
  if (!execution) return
  // A row whose instance already started must not start a second one on queue
  // retry — the workflow-lifecycle subscribers own its resolution from there.
  if (execution.workflowInstanceId) return
  if (execution.status === 'failed' || execution.status === 'cancelled') return

  const scope = { tenantId: execution.tenantId, organizationId: execution.organizationId }
  const decrypted = await findOneWithDecryption(em, ProcessInstance, { id: execution.id, ...scope }, undefined, scope)
  if (!decrypted) return

  const definition = decrypted.processDefinitionId
    ? await em.findOne(ProcessDefinition, { id: decrypted.processDefinitionId, ...scope })
    : null
  if (!definition) {
    await failBeforeStart(em, decrypted, 'Process definition missing')
    return
  }

  const workflowExecutor = container.resolve('workflowExecutor') as WorkflowExecutorLike

  // The workflow definition owns the EXECUTION identity: core provisions a
  // least-privilege principal from its `grantedFeatures` and every run acts as
  // that principal regardless of who started it. `initiatedBy` here is the
  // INVOKER — provenance for the audit trail, never an ACL identity, and null for
  // a schedule or event entry which has no human behind it.
  const initiatedBy = parseTriggeredByUser(decrypted.triggeredBy)

  let instanceId: string
  let instanceVersion: number | undefined
  try {
    const instance = await workflowExecutor.startWorkflow(em, {
      workflowId: definition.workflowId,
      initialContext: (decrypted.input ?? {}) as Record<string, unknown>,
      // Ties the instance back to the execution that claimed the idempotency key,
      // so the pair can be reconciled without a temporal lookup in either direction.
      correlationKey: `process_execution:${decrypted.id}`,
      ...(initiatedBy ? { metadata: { initiatedBy } } : {}),
      tenantId: decrypted.tenantId,
      organizationId: decrypted.organizationId,
    })
    instanceId = instance.id
    instanceVersion = instance.version
  } catch (error) {
    await failBeforeStart(em, decrypted, error instanceof Error ? error.message : 'Workflow start failed')
    return
  }

  decrypted.workflowInstanceId = instanceId
  if (instanceVersion != null) decrypted.workflowVersion = String(instanceVersion)
  decrypted.lastActivityAt = new Date()
  await em.flush()

  try {
    await workflowExecutor.executeWorkflow(em, container, instanceId, initiatedBy ? { userId: initiatedBy } : undefined)
  } catch (error) {
    // The executor persists instance failure itself and emits
    // workflows.instance.failed — the subscriber owns the projection flip.
    logger.warn('workflow execution error (instance state is authoritative)', {
      executionId: decrypted.id,
      instanceId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
