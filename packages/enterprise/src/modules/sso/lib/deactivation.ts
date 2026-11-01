import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { SsoConfig, SsoUserDeactivation } from '../data/entities'

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
  if (deactivation) return true
  if (!scope.tenantId) return false

  const legacyDeactivation = await findOneWithDecryption(
    em, SsoUserDeactivation,
    {
      userId: scope.userId,
      tenantId: null,
      organizationId: scope.organizationId,
      reactivatedAt: null,
      ...(scope.ssoConfigId ? { ssoConfigId: scope.ssoConfigId } : {}),
    },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!legacyDeactivation) return false

  const organization = await findOneWithDecryption(
    em, Organization,
    { id: scope.organizationId, tenant: scope.tenantId },
    { fields: ['id'] },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!organization) return false

  const config = await findOneWithDecryption(
    em, SsoConfig,
    { id: legacyDeactivation.ssoConfigId, organizationId: scope.organizationId, tenantId: null },
    { fields: ['id'] },
    { tenantId: null, organizationId: scope.organizationId },
  )
  return config !== null
}
