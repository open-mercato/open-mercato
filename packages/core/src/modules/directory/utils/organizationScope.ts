import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { parseSelectedOrganizationCookie, parseSelectedTenantCookie } from './scopeCookies'

export { parseSelectedOrganizationCookie, parseSelectedTenantCookie }

export type OrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
  tenantId: string | null
}

export function getSelectedOrganizationFromRequest(req: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } }): string | null {
  const cookieContainer = (req as { cookies?: { get: (name: string) => { value: string } | undefined } }).cookies
  if (cookieContainer && typeof cookieContainer.get === 'function') {
    const val = cookieContainer.get('om_selected_org')?.value
    return val ?? null
  }
  const headerContainer = (req as { headers?: { get(name: string): string | null } }).headers
  const header = typeof headerContainer?.get === 'function' ? headerContainer.get('cookie') : null
  return parseSelectedOrganizationCookie(header)
}

export function getSelectedTenantFromRequest(
  req: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } },
): string | null {
  const cookieContainer = (req as { cookies?: { get: (name: string) => { value: string } | undefined } }).cookies
  if (cookieContainer && typeof cookieContainer.get === 'function') {
    const val = cookieContainer.get('om_selected_tenant')?.value
    return val ?? null
  }
  const headerContainer = (req as { headers?: { get(name: string): string | null } }).headers
  const header = typeof headerContainer?.get === 'function' ? headerContainer.get('cookie') : null
  return parseSelectedTenantCookie(header)
}

async function collectWithDescendants(em: EntityManager, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const unique = Array.from(new Set(
    ids.filter((value): value is string => {
      if (!value) return false
      if (isAllOrganizationsSelection(value)) return false
      return true
    })
  ))
  if (!unique.length) return new Set()
  const filter: FilterQuery<Organization> = {
    tenant: tenantId,
    id: { $in: unique },
    deletedAt: null,
  }
  const orgs = await em.find(Organization, filter)
  const set = new Set<string>()
  for (const org of orgs) {
    const id = String(org.id)
    set.add(id)
    if (Array.isArray(org.descendantIds)) {
      for (const desc of org.descendantIds) set.add(String(desc))
    }
  }
  return set
}

export async function resolveOrganizationScope({
  em,
  rbac,
  auth,
  selectedId,
  tenantId: tenantIdOverride,
}: {
  em: EntityManager
  rbac: RbacService
  auth: AuthContext
  selectedId?: string | null
  tenantId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const actorTenantId = typeof auth.tenantId === 'string' && auth.tenantId.trim().length > 0 ? auth.tenantId.trim() : null
  const candidateTenantId = typeof tenantIdOverride === 'string' && tenantIdOverride.trim().length > 0
    ? tenantIdOverride.trim()
    : tenantIdOverride === null
      ? null
      : actorTenantId
  if (!candidateTenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const usingOverride = candidateTenantId !== actorTenantId
  const isSuperAdminActor = auth.isSuperAdmin === true
  const tenantId = usingOverride && actorTenantId && !isSuperAdminActor ? actorTenantId : candidateTenantId
  if (!tenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }
  const explicitAllSelection = selectedId === null
  const normalizedSelectedId = typeof selectedId === 'string' && isAllOrganizationsSelection(selectedId)
    ? null
    : (selectedId ?? null)
  const contextOrgId = actorTenantId && actorTenantId === tenantId ? auth.orgId ?? null : null
  const acl = await rbac.loadAcl(auth.sub, { tenantId, organizationId: contextOrgId })
  const aclIsSuperAdmin = acl?.isSuperAdmin === true
  const effectiveSuperAdmin = aclIsSuperAdmin || isSuperAdminActor
  const rawAccessible = effectiveSuperAdmin
    ? null
    : Array.isArray(acl?.organizations)
      ? acl.organizations.filter(Boolean)
      : null
  const accessibleList = effectiveSuperAdmin
    ? null
    : rawAccessible && rawAccessible.some((value) => typeof value === 'string' && isAllOrganizationsSelection(value))
      ? null
      : rawAccessible?.filter((value): value is string => typeof value === 'string' && !isAllOrganizationsSelection(value)) ?? null

  const accountOrgId = actorTenantId && actorTenantId === tenantId ? auth.orgId ?? null : null
  const fallbackOrgId = accountOrgId ?? null
  let fallbackSet: Set<string> | null = null
  const loadFallbackSet = async (): Promise<Set<string> | null> => {
    if (!fallbackOrgId) return null
    if (!fallbackSet) {
      fallbackSet = await collectWithDescendants(em, tenantId, [fallbackOrgId])
    }
    return fallbackSet
  }

  let allowedSet: Set<string> | null = null
  if (accessibleList === null) {
    allowedSet = null
  } else if (accessibleList.length === 0) {
    allowedSet = new Set()
  } else {
    allowedSet = await collectWithDescendants(em, tenantId, accessibleList)
  }

  if (allowedSet && allowedSet.size === 0 && fallbackOrgId) {
    const computed = await loadFallbackSet()
    if (computed && computed.size > 0) {
      allowedSet = computed
    }
  }

  const initialSelected = normalizedSelectedId ?? (explicitAllSelection && effectiveSuperAdmin ? null : accountOrgId ?? null)
  let effectiveSelected: string | null = null
  if (initialSelected) {
    if (allowedSet === null || allowedSet.has(initialSelected)) {
      effectiveSelected = initialSelected
    }
  }

  let filterSet: Set<string> | null = null
  if (effectiveSelected) {
    filterSet = await collectWithDescendants(em, tenantId, [effectiveSelected])
  } else if (allowedSet !== null) {
    filterSet = allowedSet
  } else if (explicitAllSelection && effectiveSuperAdmin) {
    filterSet = null
  } else if (auth.orgId) {
    filterSet = await loadFallbackSet()
  }

  if ((!filterSet || filterSet.size === 0) && fallbackOrgId && !(explicitAllSelection && effectiveSuperAdmin)) {
    const computed = await loadFallbackSet()
    if (computed && computed.size > 0) {
      filterSet = computed
      if (!effectiveSelected) {
        effectiveSelected = fallbackOrgId
      }
    }
  }

  return {
    selectedId: effectiveSelected,
    filterIds: filterSet ? Array.from(filterSet) : null,
    allowedIds: allowedSet ? Array.from(allowedSet) : null,
    tenantId,
  }
}

export async function resolveOrganizationScopeForRequest({
  container,
  auth,
  request,
  selectedId,
  tenantId: tenantOverride,
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined }; headers?: { get(name: string): string | null } }
  selectedId?: string | null
  tenantId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }

  let em: EntityManager | null = null
  let rbac: RbacService | null = null
  try { em = container.resolve<EntityManager>('em') } catch { em = null }
  try { rbac = container.resolve<RbacService>('rbacService') } catch { rbac = null }
  if (!em || !rbac) {
    const fallbackSelected = selectedId ?? auth.orgId ?? null
    return {
      selectedId: fallbackSelected,
      filterIds: fallbackSelected ? [fallbackSelected] : null,
      allowedIds: fallbackSelected ? [fallbackSelected] : null,
      tenantId: auth.tenantId ?? null,
    }
  }

  const normalizeString = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    return null
  }

  const actorTenantField = (auth as { actorTenantId?: string | null }).actorTenantId
  const actorTenant = actorTenantField === undefined
    ? normalizeString(auth.tenantId)
    : actorTenantField === null
      ? null
      : normalizeString(actorTenantField)
  const actorOrgField = (auth as { actorOrgId?: string | null }).actorOrgId
  const actorOrgId = actorOrgField === undefined
    ? normalizeString(auth.orgId)
    : actorOrgField === null
      ? null
      : normalizeString(actorOrgField)

  const cookieTenant = request ? getSelectedTenantFromRequest(request) : null
  const requestedTenant =
    tenantOverride !== undefined
      ? tenantOverride
      : cookieTenant !== undefined
        ? cookieTenant
        : undefined
  const requestedTenantId = typeof requestedTenant === 'string' && requestedTenant.trim().length > 0 ? requestedTenant.trim() : null
  const isSuperAdminActor = auth.isSuperAdmin === true
  let effectiveTenantId = requestedTenantId ?? actorTenant ?? null
  if (actorTenant && effectiveTenantId && effectiveTenantId !== actorTenant && !isSuperAdminActor) {
    effectiveTenantId = actorTenant
  }
  if (!effectiveTenantId) {
    return { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
  }

  const scopedAuth = {
    ...auth,
    tenantId: effectiveTenantId,
    orgId: actorTenant && actorTenant === effectiveTenantId ? actorOrgId ?? null : null,
  }

  const rawSelected = selectedId !== undefined ? selectedId : (request ? getSelectedOrganizationFromRequest(request) : null)
  const reqSelected = typeof rawSelected === 'string' && isAllOrganizationsSelection(rawSelected) ? null : rawSelected
  const baseScope = await resolveOrganizationScope({
    em,
    rbac,
    auth: scopedAuth,
    selectedId: reqSelected,
    tenantId: effectiveTenantId,
  })

  return baseScope
}

export type FeatureCheckContext = {
  organizationId: string | null
  scope: OrganizationScope
  allowedOrganizationIds: string[] | null
}

export async function resolveFeatureCheckContext({
  container,
  auth,
  request,
  selectedId,
  tenantId,
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined } }
  selectedId?: string | null
  tenantId?: string | null
}): Promise<FeatureCheckContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request, selectedId, tenantId })
  const allowedOrganizationIds = scope.allowedIds ?? null
  const authOrgId = auth?.orgId ?? null
  const organizationId =
    scope.selectedId
    ?? (authOrgId && (!Array.isArray(allowedOrganizationIds) || allowedOrganizationIds.includes(authOrgId)) ? authOrgId : null)
    ?? (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length ? allowedOrganizationIds[0] : null)

  return { organizationId, scope, allowedOrganizationIds }
}
