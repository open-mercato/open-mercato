import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InsightsProcessSettings } from '../data/entities'
import { buildWorkflowConformanceModel } from './analytics/workflowModel'
import { XRAY_ANALYTICS_LIMITS, type ConformanceResult, type DesignedProcessModel } from './analytics/types'
import type { XrayContainer } from './projection/runtime'
import { resolveWorkflowDraftService } from './workflowsBridge'

export const XRAY_WORKFLOW_DEFINITIONS_VIEW_FEATURE = 'workflows.definitions.view'

type RbacFeatureChecker = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
}

function resolveRbacFeatureChecker(container: XrayContainer): RbacFeatureChecker | null {
  try {
    const rbac = container.resolve('rbacService') as Partial<RbacFeatureChecker> | undefined
    return rbac && typeof rbac.userHasAllFeatures === 'function' ? rbac as RbacFeatureChecker : null
  } catch {
    return null
  }
}

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

/**
 * The configured-workflow models whose definition the caller may identify: the caller holds
 * `workflows.definitions.view` (wildcard-aware `rbacService.userHasAllFeatures`) in every
 * organization that configured the model (`organizationModelKeys`: organization → model key).
 * Fails closed: nothing is disclosable without the RBAC service.
 */
export async function resolveDisclosableXrayModelKeys(
  container: XrayContainer,
  params: { userId: string; tenantId: string; organizationModelKeys: Readonly<Record<string, string>> },
): Promise<Set<string>> {
  const disclosable = new Set<string>()
  const rbac = resolveRbacFeatureChecker(container)
  if (!rbac || !params.userId) return disclosable
  const organizationsByKey = new Map<string, string[]>()
  for (const [organizationId, key] of Object.entries(params.organizationModelKeys)) {
    organizationsByKey.set(key, [...(organizationsByKey.get(key) ?? []), organizationId])
  }
  const checks = new Map<string, Promise<boolean>>()
  const holdsFeature = (organizationId: string): Promise<boolean> => {
    let pending = checks.get(organizationId)
    if (!pending) {
      pending = rbac.userHasAllFeatures(params.userId, [XRAY_WORKFLOW_DEFINITIONS_VIEW_FEATURE], { tenantId: params.tenantId, organizationId })
      checks.set(organizationId, pending)
    }
    return pending
  }
  for (const [key, organizationIds] of organizationsByKey) {
    const granted = await Promise.all(organizationIds.map(holdsFeature))
    if (granted.every(Boolean)) disclosable.add(key)
  }
  return disclosable
}

/**
 * Withholds the identity of configured workflows the caller may not view: such a model's
 * `source` becomes `null` and its key (which embeds the definition id) an opaque per-response
 * `workflow:hidden:<n>`. Ad-hoc sequence models and disclosable workflows are kept as they are.
 */
export function redactXrayConformanceSources(result: ConformanceResult, disclosable: ReadonlySet<string>): ConformanceResult {
  if (result.status !== 'ok') return result
  let hidden = 0
  return {
    ...result,
    models: result.models.map((model) => {
      if (model.source?.kind !== 'workflow' || disclosable.has(model.key)) return model
      hidden += 1
      return { ...model, key: `workflow:hidden:${hidden}`, source: null }
    }),
  }
}
