import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentProcessRun } from '../../data/entities'
import { emitAgentOrchestratorEvent } from '../../events'
import { declaredOutcomeOf, type ProcessRunOutcome } from './outcome'

export type WorkflowInstanceLifecyclePayload = {
  id?: string
  tenantId?: string
  organizationId?: string
  status?: string
}

/** The only thing this module asks of the `workflows` peer here: read one instance. */
type WorkflowInstanceReader = {
  getWorkflowInstance: (
    em: EntityManager,
    instanceId: string,
  ) => Promise<{ tenantId?: string; organizationId?: string; context?: unknown } | null>
}

type Resolver = { resolve: <T = unknown>(name: string) => T }

/**
 * Local `tryResolve` for the OPTIONAL `workflows` peer, per
 * `packages/core/AGENTS.md` § Cross-Module Coupling — never a hard `requires`,
 * never an unconditional `container.resolve`. An absent peer means the run
 * simply completes with no outcome, which is a valid completion.
 */
function tryResolveWorkflowInstanceReader(resolver: Resolver | null | undefined): WorkflowInstanceReader | null {
  if (!resolver) return null
  try {
    const executor = resolver.resolve<WorkflowInstanceReader | null>('workflowExecutor')
    return executor && typeof executor.getWorkflowInstance === 'function' ? executor : null
  } catch {
    return null
  }
}

/**
 * What the finished instance DECLARED it produced, under its context `outcome`
 * key. Best-effort: a workflow that produced nothing (research, monitoring)
 * declares none and the run's outcome columns stay null by design.
 *
 * `getWorkflowInstance` is deliberately unscoped upstream, so the instance's own
 * tenant/organization is re-checked against the run's scope before its context
 * is read — a forged instance id can never pull another tenant's context in.
 */
async function readDeclaredOutcome(
  em: EntityManager,
  resolver: Resolver | null | undefined,
  instanceId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<ProcessRunOutcome | null> {
  const reader = tryResolveWorkflowInstanceReader(resolver)
  if (!reader) return null
  try {
    const instance = await reader.getWorkflowInstance(em, instanceId)
    if (!instance) return null
    if (instance.tenantId !== scope.tenantId || instance.organizationId !== scope.organizationId) return null
    return declaredOutcomeOf(instance.context)
  } catch {
    return null
  }
}

/**
 * Resolves the `AgentProcessRun` ledger row for a finished workflow instance
 * (spec 2026-07-03 Phase 3 subscriber). Correlation key: `workflowInstanceId`,
 * stamped by the executor worker before the instance ran. Idempotent — a
 * redelivered event finds the row already terminal and does nothing. Scope is
 * taken from the emitter-attached event payload, so a forged/cross-tenant id
 * can never resolve another org's row.
 *
 * On completion it also stamps the OPTIONAL outcome the instance declared. That
 * write is part of run completion and is deliberately NOT independently
 * undoable (spec §Undo): undoing a completed run's outcome without undoing the
 * run would be a lie.
 */
export async function resolveWorkflowProcessRun(
  em: EntityManager,
  payload: WorkflowInstanceLifecyclePayload,
  outcome: 'completed' | 'failed',
  failureReason?: string,
  resolver?: Resolver | null,
): Promise<void> {
  const instanceId = typeof payload.id === 'string' ? payload.id : null
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : null
  if (!instanceId || !tenantId || !organizationId) return

  const taskRun = await em.findOne(AgentProcessRun, {
    workflowInstanceId: instanceId,
    tenantId,
    organizationId,
  })
  if (!taskRun || taskRun.status !== 'running') return

  taskRun.status = outcome
  taskRun.completedAt = new Date()
  if (outcome === 'failed') taskRun.failureReason = failureReason ?? 'Workflow instance failed'
  if (outcome === 'completed') {
    const produced = await readDeclaredOutcome(em, resolver, instanceId, { tenantId, organizationId })
    if (produced) {
      taskRun.outcomeType = produced.type
      taskRun.outcomeId = produced.id
      taskRun.outcomeLabel = produced.label ?? null
    }
  }
  await em.flush()

  await emitAgentOrchestratorEvent(
    outcome === 'completed' ? 'agent_orchestrator.process_run.completed' : 'agent_orchestrator.process_run.failed',
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
