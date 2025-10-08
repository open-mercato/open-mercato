import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
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
  const unique = Array.from(new Set(ids.filter(Boolean)))
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
  const tenantId = auth.tenantId
  const acl = await rbac.loadAcl(auth.sub, { tenantId, organizationId: auth.orgId ?? null })
  const accessibleList = Array.isArray(acl.organizations) ? acl.organizations.filter(Boolean) : null

  let allowedSet: Set<string> | null = null
  if (accessibleList === null) {
    allowedSet = null
  } else if (accessibleList.length === 0) {
    allowedSet = new Set()
  } else {
    allowedSet = await collectWithDescendants(em, tenantId, accessibleList)
  }

  const initialSelected = selectedId ?? auth.orgId ?? null
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
    filterSet = await collectWithDescendants(em, tenantId, [auth.orgId])
  }

  return {
    selectedId: effectiveSelected,
    filterIds: filterSet ? Array.from(filterSet) : null,
    allowedIds: allowedSet ? Array.from(allowedSet) : null,
  }
}
