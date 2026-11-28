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

const NONMATCHING_ID = '00000000-0000-0000-0000-000000000000'

export async function isSsoUserDeactivated(em: EntityManager, scope: DeactivationScope): Promise<boolean> {
  const organizationId = scope.organizationId ?? NONMATCHING_ID

  const deactivation = await findOneWithDecryption(
    em,
    SsoUserDeactivation,
    {
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId,
      reactivatedAt: null,
      ...(scope.ssoConfigId ? { ssoConfigId: scope.ssoConfigId } : {}),
    },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const legacyDeactivation = await findOneWithDecryption(
    em, SsoUserDeactivation,
    {
      userId: scope.userId,
      tenantId: null,
      organizationId,
      reactivatedAt: null,
      ...(scope.ssoConfigId ? { ssoConfigId: scope.ssoConfigId } : {}),
    },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const organization = await findOneWithDecryption(
    em, Organization,
    { id: organizationId, tenant: scope.tenantId ?? NONMATCHING_ID },
    { fields: ['id'] },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  const config = await findOneWithDecryption(
    em, SsoConfig,
    { id: legacyDeactivation?.ssoConfigId ?? NONMATCHING_ID, organizationId, tenantId: null },
    { fields: ['id'] },
    { tenantId: null, organizationId: scope.organizationId },
  )
  return Boolean(scope.organizationId && (deactivation || (
    scope.tenantId && legacyDeactivation && organization && config
  )))
}
