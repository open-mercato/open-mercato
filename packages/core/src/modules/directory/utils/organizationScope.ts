import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

export type OrganizationScope = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
}

export function parseSelectedOrganizationCookie(header: string | null | undefined): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith('om_selected_org=')) {
      const raw = trimmed.slice('om_selected_org='.length)
      try {
        const decoded = decodeURIComponent(raw)
        return decoded || null
      } catch {
        return raw || null
      }
    }
  }
  return null
}

export function getSelectedOrganizationFromRequest(req: Request | { cookies?: { get: (name: string) => { value: string } | undefined } }): string | null {
  const maybeCookies = (req as any)?.cookies
  if (maybeCookies && typeof maybeCookies.get === 'function') {
    const val = maybeCookies.get('om_selected_org')?.value
    return val ?? null
  }
  const header = (req as any)?.headers?.get ? (req as any).headers.get('cookie') : null
  return parseSelectedOrganizationCookie(header)
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
  const orgs: Organization[] = await em.find(Organization, { tenant: tenantId as any, id: { $in: unique }, deletedAt: null } as any)
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
}: {
  em: EntityManager
  rbac: RbacService
  auth: AuthContext
  selectedId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.tenantId || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null }
  }
  const normalizedSelectedId = typeof selectedId === 'string' && isAllOrganizationsSelection(selectedId) ? null : (selectedId ?? null)
  const tenantId = auth.tenantId
  const acl = await rbac.loadAcl(auth.sub, { tenantId, organizationId: auth.orgId ?? null })
  const rawAccessible = Array.isArray(acl.organizations) ? acl.organizations.filter(Boolean) : null
  const accessibleList =
    rawAccessible && rawAccessible.some((value) => typeof value === 'string' && isAllOrganizationsSelection(value))
      ? null
      : rawAccessible?.filter((value): value is string => typeof value === 'string' && !isAllOrganizationsSelection(value)) ?? null

  const fallbackOrgId = auth.orgId ?? null
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

  const initialSelected = normalizedSelectedId ?? auth.orgId ?? null
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
  } else if (auth.orgId) {
    filterSet = await loadFallbackSet()
  }

  if ((!filterSet || filterSet.size === 0) && fallbackOrgId) {
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
  }
}

export async function resolveOrganizationScopeForRequest({
  container,
  auth,
  request,
  selectedId,
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined } }
  selectedId?: string | null
}): Promise<OrganizationScope> {
  if (!auth || !auth.tenantId || !auth.sub) {
    return { selectedId: null, filterIds: null, allowedIds: null }
  }

  let em: EntityManager | null = null
  let rbac: RbacService | null = null
  try { em = (container.resolve('em') as EntityManager) } catch { em = null }
  try { rbac = (container.resolve('rbacService') as RbacService) } catch { rbac = null }
  if (!em || !rbac) {
    const fallbackSelected = selectedId ?? auth.orgId ?? null
    return {
      selectedId: fallbackSelected,
      filterIds: fallbackSelected ? [fallbackSelected] : null,
      allowedIds: fallbackSelected ? [fallbackSelected] : null,
    }
  }

  const rawSelected = selectedId !== undefined ? selectedId : (request ? getSelectedOrganizationFromRequest(request as any) : null)
  const reqSelected = typeof rawSelected === 'string' && isAllOrganizationsSelection(rawSelected) ? null : rawSelected
  return resolveOrganizationScope({ em, rbac, auth, selectedId: reqSelected })
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
}: {
  container: AwilixContainer
  auth: AuthContext | null | undefined
  request?: Request | { cookies?: { get: (name: string) => { value: string } | undefined } }
  selectedId?: string | null
}): Promise<FeatureCheckContext> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request, selectedId })
  const allowedOrganizationIds = scope.allowedIds ?? null
  const authOrgId = auth?.orgId ?? null
  const organizationId =
    scope.selectedId
    ?? (authOrgId && (!Array.isArray(allowedOrganizationIds) || allowedOrganizationIds.includes(authOrgId)) ? authOrgId : null)
    ?? (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length ? allowedOrganizationIds[0] : null)

  return { organizationId, scope, allowedOrganizationIds }
}
