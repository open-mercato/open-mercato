import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasGrantedFeature } from './featureAccess'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { Scope } from './productUse'

export const CRM_PEOPLE_VIEW_FEATURE = 'customers.people.view'
export const CRM_COMPANIES_VIEW_FEATURE = 'customers.companies.view'

export type CrmAccess = { people: boolean; companies: boolean }

export const NO_CRM_ACCESS: CrmAccess = { people: false, companies: false }

function hasCrmFeature(container: AwilixContainer, auth: AuthContext | null, scope: Scope, feature: string): Promise<boolean> {
  return hasGrantedFeature(container, auth, scope, feature, 'property_management.crm_permission_check_failed')
}

export async function resolveCrmAccess(container: AwilixContainer, auth: AuthContext | null, scope: Scope): Promise<CrmAccess> {
  const [people, companies] = await Promise.all([
    hasCrmFeature(container, auth, scope, CRM_PEOPLE_VIEW_FEATURE),
    hasCrmFeature(container, auth, scope, CRM_COMPANIES_VIEW_FEATURE),
  ])
  return { people, companies }
}

export type CrmRecordIds = {
  people: ReadonlyArray<string | null | undefined>
  companies: ReadonlyArray<string | null | undefined>
}

export function visibleCrmIds(access: CrmAccess, ids: CrmRecordIds): string[] {
  const wanted = [...(access.people ? ids.people : []), ...(access.companies ? ids.companies : [])]
  return Array.from(new Set(wanted.filter((id): id is string => typeof id === 'string' && id.length > 0)))
}

export async function loadCrmRecords(
  em: EntityManager,
  scope: Scope,
  access: CrmAccess,
  ids: CrmRecordIds,
): Promise<Map<string, CustomerEntity>> {
  const wanted = visibleCrmIds(access, ids)
  if (!wanted.length) return new Map()
  const customers = await findWithDecryption(em, CustomerEntity, { ...scope, id: { $in: wanted }, deletedAt: null }, undefined, scope)
  return new Map(customers.map((customer) => [customer.id, customer]))
}

export function crmName(records: ReadonlyMap<string, CustomerEntity>, id: string | null | undefined): string | null {
  return id ? records.get(id)?.displayName ?? null : null
}
