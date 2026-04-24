import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntityRole, CustomerPersonCompanyRole } from '../data/entities'

export type RoleTypeUsage = {
  total: number
  ownerAssignments: number
  relationshipAssignments: number
}

type RoleTypeUsageEntry = {
  organizationId: string
  value: string
}

function getUsageKey(organizationId: string, value: string) {
  return `${organizationId}::${value}`
}

async function loadOrganizationScopeMap(
  em: EntityManager,
  tenantId: string,
  organizationIds: string[],
): Promise<Map<string, string[]>> {
  const uniqueOrgIds = Array.from(new Set(organizationIds.filter((value) => value.trim().length > 0)))
  if (uniqueOrgIds.length === 0) return new Map()

  const organizationFilter: FilterQuery<Organization> = {
    tenant: tenantId,
    id: { $in: uniqueOrgIds },
    deletedAt: null,
  }
  const organizations = await findWithDecryption(
    em,
    Organization,
    organizationFilter,
    { fields: ['id', 'descendantIds'] },
    { tenantId, organizationId: null },
  )

  const scopeMap = new Map<string, string[]>()
  organizations.forEach((organization) => {
    const scopeIds = new Set<string>([String(organization.id)])
    if (Array.isArray(organization.descendantIds)) {
      organization.descendantIds.forEach((descendantId) => {
        if (typeof descendantId === 'string' && descendantId.trim().length > 0) {
          scopeIds.add(descendantId.trim())
        }
      })
    }
    scopeMap.set(String(organization.id), Array.from(scopeIds))
  })

  uniqueOrgIds.forEach((organizationId) => {
    if (!scopeMap.has(organizationId)) {
      scopeMap.set(organizationId, [organizationId])
    }
  })

  return scopeMap
}

export async function loadRoleTypeUsageMap(
  em: EntityManager,
  params: {
    tenantId: string
    entries: RoleTypeUsageEntry[]
  },
): Promise<Map<string, RoleTypeUsage>> {
  const normalizedEntries = Array.from(
    new Map(
      params.entries
        .map((entry) => {
          const organizationId = entry.organizationId.trim()
          const value = entry.value.trim()
          if (!organizationId || !value) return null
          return [getUsageKey(organizationId, value), { organizationId, value }] as const
        })
        .filter((entry): entry is readonly [string, RoleTypeUsageEntry] => entry !== null),
    ).values(),
  )

  if (normalizedEntries.length === 0) return new Map()

  const scopeMap = await loadOrganizationScopeMap(
    em,
    params.tenantId,
    normalizedEntries.map((entry) => entry.organizationId),
  )

  const usageEntries = await Promise.all(
    normalizedEntries.map(async (entry) => {
      const organizationScopeIds = scopeMap.get(entry.organizationId) ?? [entry.organizationId]
      const [ownerAssignments, relationshipAssignments] = await Promise.all([
        em.count(CustomerEntityRole, {
          tenantId: params.tenantId,
          organizationId: { $in: organizationScopeIds },
          roleType: entry.value,
        }),
        em.count(CustomerPersonCompanyRole, {
          tenantId: params.tenantId,
          organizationId: { $in: organizationScopeIds },
          roleValue: entry.value,
        }),
      ])

      return [
        getUsageKey(entry.organizationId, entry.value),
        {
          total: ownerAssignments + relationshipAssignments,
          ownerAssignments,
          relationshipAssignments,
        } satisfies RoleTypeUsage,
      ] as const
    }),
  )

  return new Map(usageEntries)
}

export async function loadRoleTypeUsage(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    value: string
  },
): Promise<RoleTypeUsage> {
  const usageMap = await loadRoleTypeUsageMap(em, {
    tenantId: params.tenantId,
    entries: [{ organizationId: params.organizationId, value: params.value }],
  })

  return (
    usageMap.get(getUsageKey(params.organizationId, params.value)) ?? {
      total: 0,
      ownerAssignments: 0,
      relationshipAssignments: 0,
    }
  )
}

export function resolveRoleTypeUsageKey(organizationId: string, value: string) {
  return getUsageKey(organizationId, value)
}
