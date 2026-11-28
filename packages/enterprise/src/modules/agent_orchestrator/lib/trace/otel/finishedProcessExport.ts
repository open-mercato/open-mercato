import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentRun } from '../../../data/entities'
import { AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE, getAgentOrchestratorQueue } from '../../queue'
import { enqueueOtelExportForFinishedProcess, type ExportableTopLevelRunFilter } from './exportJob'
import type { OtelExportContainer } from './exportSettings'

/** Latest top-level run of one execution the export gate would accept; scoped to the tenant and organization. */
export async function findLatestTopLevelRunId(
  em: EntityManager,
  filter: ExportableTopLevelRunFilter,
): Promise<string | null> {
  const run = await em.findOne(
    AgentRun,
    {
      tenantId: filter.tenantId,
      organizationId: filter.organizationId,
      workflowInstanceId: filter.workflowInstanceId,
      parentRunId: null,
      deletedAt: null,
      source: { $in: filter.sources as AgentRun['source'][] },
      ...(filter.agentAllowlist ? { agentId: { $in: filter.agentAllowlist } } : {}),
    },
    { orderBy: { createdAt: 'desc' }, fields: ['id'] },
  )
  return run?.id ?? null
}

/**
 * Called by the terminal workflow-lifecycle subscribers once the projection
 * row is terminal, so the re-exported run carries the `invoke_workflow` root.
 */
export async function enqueueOtelExportForFinishedProcessEvent(
  em: EntityManager,
  container: OtelExportContainer,
  payload: unknown,
): Promise<boolean> {
  return enqueueOtelExportForFinishedProcess(payload, container, {
    enqueue: (job, options) => getAgentOrchestratorQueue(AGENT_ORCHESTRATOR_OTEL_EXPORT_QUEUE).enqueue(job, options),
    findLatestTopLevelRunId: (filter) => findLatestTopLevelRunId(em, filter),
  })
}
