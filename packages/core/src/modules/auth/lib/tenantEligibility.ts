import type { EntityManager } from '@mikro-orm/postgresql'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export async function isStaffTenantActive(
  em: EntityManager,
  tenantId: string | null | undefined,
): Promise<boolean> {
  if (tenantId == null) return true
  const tenant = await findOneWithDecryption(
    em,
    Tenant,
    { id: tenantId, isActive: true, deletedAt: null },
    { fields: ['id'], refresh: true },
  )
  return tenant !== null
}
