import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { TraceIngest } from '../../data/validators'

/**
 * Fail-closed scope validation for the trace-ingest write path
 * (GHSA-429h-x9x8-rv2m, GHSA-xch5-xj47-xcxm).
 *
 * The HMAC proves the tenant, but the organization arrives in the unsigned
 * `x-om-organization-id` header, and the payload may reference a workflow
 * instance. Neither may widen the verified scope:
 *
 * - The organization must exist and belong to the verified tenant. A uniform
 *   401 (byte-identical to the HMAC-failure body) keeps the endpoint from
 *   becoming an existence oracle for other tenants' organizations.
 * - A non-null `workflowInstanceId` must resolve to a workflow instance in the
 *   same tenant AND organization as the ingest scope, otherwise an ingested
 *   run could roll cost into any process instance of the tenant — including
 *   one it never ran in. Resolved through the optional `workflows` peer with
 *   the same soft-resolve `processProjection` uses; an absent peer skips the
 *   reference check (no process projection exists to poison in that
 *   deployment), and a resolution error is treated as "no reader" so a
 *   broken peer fails the same way an absent one does.
 *
 * Numeric fields (`confidence` 0-1, `costMinor` upper bound) and the
 * `stepId`-requires-`workflowInstanceId` rule are enforced by
 * `traceIngestSchema` in `data/validators.ts`.
 */
export type TraceIngestScope = { tenantId: string; organizationId: string }

type WorkflowInstanceScope = { tenantId?: string | null; organizationId?: string | null }

type WorkflowInstanceReader = {
  getWorkflowInstance: (
    em: EntityManager,
    instanceId: string,
  ) => Promise<WorkflowInstanceScope | null>
}

type Resolver = { resolve: <T = unknown>(name: string) => T }

function tryResolveWorkflowInstanceReader(container: unknown): WorkflowInstanceReader | null {
  const resolver = container as Resolver | null | undefined
  if (!resolver || typeof resolver.resolve !== 'function') return null
  try {
    const executor = resolver.resolve<WorkflowInstanceReader | null>('workflowExecutor')
    return executor && typeof executor.getWorkflowInstance === 'function' ? executor : null
  } catch {
    return null
  }
}

export async function assertTraceIngestScope(
  em: EntityManager,
  container: unknown,
  scope: TraceIngestScope,
  payload: Pick<TraceIngest, 'workflowInstanceId'>,
): Promise<void> {
  const organization = await em.findOne(Organization, {
    id: scope.organizationId,
    tenant: scope.tenantId,
    deletedAt: null,
  })
  if (!organization) {
    throw new CrudHttpError(401, { error: 'Trace ingest verification failed' })
  }

  if (payload.workflowInstanceId == null) return
  const reader = tryResolveWorkflowInstanceReader(container)
  if (!reader) return
  const instance = await reader.getWorkflowInstance(em, payload.workflowInstanceId)
  if (
    !instance
    || instance.tenantId !== scope.tenantId
    || instance.organizationId !== scope.organizationId
  ) {
    throw new CrudHttpError(422, {
      error: 'Invalid trace payload',
      code: 'workflow_instance_out_of_scope',
    })
  }
}
