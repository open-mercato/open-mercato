import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export async function isCustomerTenantActive(em: EntityManager, tenantId: string): Promise<boolean> {
  if (!tenantId) return false
  const tenant = await findOneWithDecryption(
    em,
    Tenant,
    { id: tenantId, isActive: true, deletedAt: null },
    { refresh: true },
  )
  return Boolean(tenant)
}
