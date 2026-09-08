import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WarrantyClaim } from '../data/entities'

export type PortalClaimOwnerScope = {
  tenantId: string
  organizationId: string
  customerId: string
}

export function buildPortalOwnedClaimWhere(
  scope: PortalClaimOwnerScope,
  extra: Record<string, unknown> = {},
): Record<string, unknown> & FilterQuery<WarrantyClaim> {
  return {
    ...extra,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    customerId: scope.customerId,
    claimType: { $ne: 'vendor_recovery' },
    deletedAt: null,
  } as Record<string, unknown> & FilterQuery<WarrantyClaim>
}

export async function loadPortalOwnedClaim(
  em: EntityManager,
  scope: PortalClaimOwnerScope,
  claimId: string,
): Promise<WarrantyClaim | null> {
  return findOneWithDecryption(
    em,
    WarrantyClaim,
    buildPortalOwnedClaimWhere(scope, { id: claimId }),
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}
