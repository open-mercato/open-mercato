import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoUserDeactivation } from '../data/entities'

type DeactivationScope = {
  userId: string
  tenantId: string | null
  organizationId: string | null
  ssoConfigId?: string
}

export async function isSsoUserDeactivated(em: EntityManager, scope: DeactivationScope): Promise<boolean> {
  if (!scope.organizationId) return false

  const deactivation = await findOneWithDecryption(
    em,
    SsoUserDeactivation,
    {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      reactivatedAt: null,
      ...(scope.ssoConfigId ? { ssoConfigId: scope.ssoConfigId } : {}),
    },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return deactivation !== null
}
