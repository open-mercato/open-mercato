import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { compareCodeUnits, getProcessRegistry, type RegisteredProcess } from './process/registry'
import type { AnalyticsViewer } from './analytics/types'

export const XRAY_VIEW_FEATURE = 'insights.xray.view'

export const XRAY_VIEW_INDIVIDUALS_FEATURE = 'insights.xray.view_individuals'

const MAX_VIEWER_FEATURES = 5000

const MAX_FEATURE_LENGTH = 200

type ScopeRequestView = {
  headers?: { get(name: string): string | null }
  cookies?: { get: (name: string) => { value: string } | undefined }
}

type XrayRbac = {
  userHasAllFeatures: (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>
  loadAcl: (userId: string, scope: { tenantId: string | null; organizationId: string | null }) => Promise<{ isSuperAdmin: boolean; features: string[] }>
}

/**
 * Who reads X-Ray analytics of one process and where: the tenant, the organization filter the
 * analytics apply (`null` = tenant-wide for an unrestricted reader, `[]` = nothing, a list =
 * those organizations, as `resolveOrganizationScopeFilter`), whether the caller holds
 * `insights.xray.view` plus the process's `requiredFeatures` (`visible`), and the analytics
 * viewer (granted features for the cache fingerprint, the per-person grant).
 */
export type XrayAnalyticsAccess = {
  tenantId: string
  organizationIds: string[] | null
  rbacOrganizationId: string | null
  visible: boolean
  viewer: AnalyticsViewer
}

function isXrayRbac(value: unknown): value is XrayRbac {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof XrayRbac, unknown>>
  return typeof candidate.userHasAllFeatures === 'function' && typeof candidate.loadAcl === 'function'
}

function resolveRbac(container: AwilixContainer): XrayRbac | null {
  try {
    const rbac = container.resolve('rbacService')
    return isXrayRbac(rbac) ? rbac : null
  } catch {
    return null
  }
}

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** `insights.xray.view` plus the process's declared features, deduplicated and sorted. */
export function xrayProcessFeatures(process: Pick<RegisteredProcess, 'requiredFeatures'>): string[] {
  const features = process.requiredFeatures.filter((feature) => typeof feature === 'string' && feature.length > 0)
  return Array.from(new Set([XRAY_VIEW_FEATURE, ...features])).sort(compareCodeUnits)
}

/** A registered process by key (only once the registry is ready), or `null`. */
export function findRegisteredProcess(processKey: string): RegisteredProcess | null {
  const registry = getProcessRegistry()
  if (!registry.ready) return null
  return registry.processes.find((candidate) => candidate.processKey === processKey) ?? null
}

function viewerFeatures(acl: { isSuperAdmin: boolean; features: string[] }): string[] {
  const granted = acl.features.filter((feature) => typeof feature === 'string' && feature.length > 0 && feature.length <= MAX_FEATURE_LENGTH)
  return Array.from(new Set([...(acl.isSuperAdmin ? ['*'] : []), ...granted])).sort(compareCodeUnits).slice(0, MAX_VIEWER_FEATURES)
}

/**
 * Resolves X-Ray analytics access for `requiredFeatures` (`insights.xray.view` and the process's
 * features) exactly like the route guard: the organization scope is resolved for those features
 * (`resolveFeatureCheckContext`, so a caller without a selected organization only covers the
 * organizations where they hold them), and every check runs through the wildcard-aware
 * `rbacService.userHasAllFeatures` at the feature-check organization. Fails closed: `null`
 * without a subject or a resolved tenant, `visible: false` without the RBAC service.
 * `viewer.canViewIndividuals` is checked at the feature-check organization only, which does not
 * cover a multi-organization scope: per-person reads use `resolveXrayIndividualsAccess`.
 */
export async function resolveXrayAnalyticsAccess(params: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request: ScopeRequestView
  requiredFeatures: readonly string[]
}): Promise<XrayAnalyticsAccess | null> {
  const auth = params.auth
  const userId = normalizeId(auth?.sub)
  if (!auth || !userId) return null
  const requiredFeatures = Array.from(new Set(params.requiredFeatures.filter((feature) => feature.length > 0)))
  const featureContext = await resolveFeatureCheckContext({
    container: params.container,
    auth,
    request: params.request,
    requiredFeatures,
  })
  const tenantId = normalizeId(featureContext.scope.tenantId) ?? normalizeId(auth.tenantId)
  if (!tenantId) return null
  const filter = resolveOrganizationScopeFilter(featureContext.scope, auth)
  const organizationIds = filter.organizationIds === undefined
    ? null
    : Array.from(new Set(filter.organizationIds.map((organizationId) => organizationId.toLowerCase())))
  const rbacOrganizationId = featureContext.organizationId ?? null
  const rbac = resolveRbac(params.container)
  const rbacScope = { tenantId, organizationId: rbacOrganizationId }
  const visible = rbac && requiredFeatures.length > 0 ? await rbac.userHasAllFeatures(userId, requiredFeatures, rbacScope) : false
  const canViewIndividuals = rbac && visible ? await rbac.userHasAllFeatures(userId, [XRAY_VIEW_INDIVIDUALS_FEATURE], rbacScope) : false
  const acl = rbac && visible ? await rbac.loadAcl(userId, rbacScope) : { isSuperAdmin: false, features: [] }
  return {
    tenantId: tenantId.toLowerCase(),
    organizationIds,
    rbacOrganizationId,
    visible,
    viewer: {
      userId: isUuid(userId) ? userId.toLowerCase() : null,
      features: viewerFeatures(acl),
      canViewIndividuals,
    },
  }
}

function freshScopeRequestView(request: ScopeRequestView): ScopeRequestView {
  const view: ScopeRequestView = {}
  if (request.headers) view.headers = request.headers
  if (request.cookies) view.cookies = request.cookies
  return view
}

function intersectOrganizationIds(scope: string[] | null, narrowed: string[] | null): string[] | null {
  if (narrowed === null) return scope
  if (scope === null) return narrowed
  const allowed = new Set(narrowed)
  return scope.filter((organizationId) => allowed.has(organizationId))
}

/**
 * Access for a per-person read (`groupBy=user`) of one process, derived from the granted view
 * `access`. The organization scope is resolved again for the view features plus
 * `insights.xray.view_individuals` (on a fresh request view, so the scope bound for the view
 * features is not reused): a scope without a selected organization is NARROWED to the
 * organizations where the caller holds all of them, and the feature check runs, wildcard-aware,
 * at the feature-check organization (the selected one, else the caller's own). The per-person
 * scope is that narrowed scope intersected with the view scope, so it is never wider than the
 * view, and every organization in it holds the feature. Fails closed: `null` when the view is
 * not visible, the caller lacks the features at the feature-check organization (e.g. the
 * selected organization), the tenant differs, or no organization remains.
 */
export async function resolveXrayIndividualsAccess(params: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request: ScopeRequestView
  process: Pick<RegisteredProcess, 'requiredFeatures'>
  access: XrayAnalyticsAccess
}): Promise<XrayAnalyticsAccess | null> {
  if (!params.access.visible) return null
  const individuals = await resolveXrayAnalyticsAccess({
    container: params.container,
    auth: params.auth,
    request: freshScopeRequestView(params.request),
    requiredFeatures: [...xrayProcessFeatures(params.process), XRAY_VIEW_INDIVIDUALS_FEATURE],
  })
  if (!individuals || !individuals.visible || !individuals.viewer.canViewIndividuals) return null
  if (individuals.tenantId !== params.access.tenantId) return null
  const organizationIds = intersectOrganizationIds(params.access.organizationIds, individuals.organizationIds)
  if (organizationIds !== null && organizationIds.length === 0) return null
  return { ...individuals, organizationIds }
}
