import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentTaskRun } from '../../data/entities'
import { emitAgentOrchestratorEvent } from '../../events'

export type WorkflowInstanceLifecyclePayload = {
  id?: string
  tenantId?: string
  organizationId?: string
  status?: string
}

/**
 * Resolves the `AgentTaskRun` ledger row for a finished workflow instance
 * (spec 2026-07-03 Phase 3 subscriber). Correlation key: `workflowInstanceId`,
 * stamped by the executor worker before the instance ran. Idempotent — a
 * redelivered event finds the row already terminal and does nothing. Scope is
 * taken from the emitter-attached event payload, so a forged/cross-tenant id
 * can never resolve another org's row.
 */
export async function resolveWorkflowTaskRun(
  em: EntityManager,
  payload: WorkflowInstanceLifecyclePayload,
  outcome: 'completed' | 'failed',
  failureReason?: string,
): Promise<void> {
  const instanceId = typeof payload.id === 'string' ? payload.id : null
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (!instanceId || !tenantId || !organizationId) return

  const taskRun = await em.findOne(AgentTaskRun, {
    workflowInstanceId: instanceId,
    tenantId,
    organizationId,
  })
  if (!taskRun || taskRun.status !== 'running') return

  taskRun.status = outcome
  taskRun.completedAt = new Date()
  if (outcome === 'failed') taskRun.failureReason = failureReason ?? 'Workflow instance failed'
  await em.flush()

  await emitAgentOrchestratorEvent(
    outcome === 'completed' ? 'agent_orchestrator.task_run.completed' : 'agent_orchestrator.task_run.failed',
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
