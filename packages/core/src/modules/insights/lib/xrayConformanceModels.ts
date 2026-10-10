import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../data/entities'
import { buildWorkflowConformanceModel } from './analytics/workflowModel'
import { XRAY_ANALYTICS_LIMITS, type DesignedProcessModel } from './analytics/types'
import type { XrayContainer } from './projection/runtime'
import { resolveWorkflowDraftService } from './workflowsBridge'

export type XrayConformanceModelsOutcome =
  | { ok: true; models: DesignedProcessModel[]; organizationModelKeys: Record<string, string> }
  | { ok: false; code: 'workflows_unavailable' | 'conformance_model_missing' | 'too_many_models' }

/**
 * The designed models of the organizations in scope (`null` = the tenant's): each enabled
 * organization's configured conformance workflow (`conformanceWorkflowId`, read through the
 * workflows module's `workflowDraftService` scoped to that tenant and organization) projected
 * onto its `activityStepMap`. Organizations without a configuration, or whose workflow no longer
 * resolves, get no model (their cases are reported as unresolved). Refuses without the workflows
 * module, without any model, or with more models than one call compares.
 */
export async function resolveXrayConformanceModels(
  container: XrayContainer,
  scope: { tenantId: string; organizationIds: readonly string[] | null },
): Promise<XrayConformanceModelsOutcome> {
  const service = resolveWorkflowDraftService(container)
  if (!service) return { ok: false, code: 'workflows_unavailable' }
  if (scope.organizationIds !== null && scope.organizationIds.length === 0) return { ok: false, code: 'conformance_model_missing' }
  const em = (container.resolve('em') as EntityManager).fork()
  const rows = await findWithDecryption(
    em,
    InsightsProcessSettings,
    {
      tenantId: scope.tenantId,
      enabled: true,
      deletedAt: null,
      conformanceWorkflowId: { $ne: null },
      ...(scope.organizationIds !== null ? { organizationId: { $in: [...scope.organizationIds] } } : {}),
    },
    { orderBy: { organizationId: 'asc' }, limit: XRAY_ANALYTICS_LIMITS.maxModels + 1 },
    { tenantId: scope.tenantId },
  )
  if (rows.length > XRAY_ANALYTICS_LIMITS.maxModels) return { ok: false, code: 'too_many_models' }
  const models = new Map<string, DesignedProcessModel>()
  const organizationModelKeys: Record<string, string> = {}
  for (const row of rows) {
    if (row.tenantId.toLowerCase() !== scope.tenantId.toLowerCase() || !row.conformanceWorkflowId) continue
    const organizationId = row.organizationId.toLowerCase()
    const definition = await service.getDefinitionForScope(row.conformanceWorkflowId, { tenantId: scope.tenantId, organizationId })
    const model = definition ? buildWorkflowConformanceModel(definition, row.activityStepMap ?? null) : null
    if (!model) continue
    models.set(model.key, model)
    organizationModelKeys[organizationId] = model.key
  }
  if (models.size === 0) return { ok: false, code: 'conformance_model_missing' }
  return { ok: true, models: Array.from(models.values()), organizationModelKeys }
}
