import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AgentRun } from '../../data/entities'
import type { TraceIngest } from '../../data/validators'

type TraceIngestScope = { tenantId: string; organizationId: string }

type WorkflowReferenceReader = {
  hasWorkflowStepReference: (
    em: EntityManager,
    scope: TraceIngestScope,
    workflowInstanceId: string,
    stepId: string,
    stepInstanceId: string,
  ) => Promise<boolean>
}

type Resolver = { resolve: (name: string) => unknown }

function resolveWorkflowReferenceReader(container: Resolver): WorkflowReferenceReader | undefined {
  try {
    const executor = container.resolve('workflowExecutor') as Partial<WorkflowReferenceReader> | undefined
    if (typeof executor?.hasWorkflowStepReference === 'function') return executor as WorkflowReferenceReader
  } catch {
    return undefined
  }
}

export async function assertTraceIngestOrganization(em: EntityManager, scope: TraceIngestScope): Promise<void> {
  const organization = await findOneWithDecryption(
    em, Organization, { id: scope.organizationId, tenant: scope.tenantId, deletedAt: null }, { fields: ['id'] }, scope,
  )
  if (!organization) throw new CrudHttpError(401, { error: 'Trace ingest verification failed' })
}

export async function assertTraceIngestRun(
  em: EntityManager,
  container: Resolver,
  scope: TraceIngestScope,
  payload: Pick<TraceIngest, 'agentId' | 'workflowInstanceId' | 'stepId'>,
  run: Pick<AgentRun, 'id' | 'agentId' | 'deletedAt' | 'workflowInstanceId' | 'stepId' | 'invocationId'> | null,
  trustedOpenCodeRunId?: string,
): Promise<void> {
  const workflowInstanceId = run?.workflowInstanceId ?? null
  const stepId = run?.stepId ?? null
  const invalidReference = () => new CrudHttpError(422, {
    error: 'Invalid trace payload',
    code: 'workflow_instance_out_of_scope',
  })

  if (
    (run && (run.deletedAt != null || run.agentId !== payload.agentId))
    || (payload.workflowInstanceId !== undefined && payload.workflowInstanceId !== workflowInstanceId)
    || (payload.stepId !== undefined && payload.stepId !== stepId)
  ) throw invalidReference()

  if (trustedOpenCodeRunId !== undefined) {
    if (run?.id !== trustedOpenCodeRunId || payload.workflowInstanceId !== undefined || payload.stepId !== undefined) {
      throw invalidReference()
    }
    return
  }

  if (workflowInstanceId === null && stepId === null) return
  if (!workflowInstanceId || !stepId || !run?.invocationId) throw invalidReference()

  const reader = resolveWorkflowReferenceReader(container)
  if (!reader || !(await reader.hasWorkflowStepReference(em, scope, workflowInstanceId, stepId, run.invocationId))) {
    throw invalidReference()
  }
}
