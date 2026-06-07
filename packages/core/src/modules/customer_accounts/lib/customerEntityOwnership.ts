import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export type CustomerEntityScope = {
  tenantId: string | null | undefined
  organizationId: string | null | undefined
}

/**
 * Confirms that a caller-supplied `customerEntityId` (the CRM company FK linked
 * onto a customer user) exists, is a company, is not soft-deleted, and belongs
 * to the caller's tenant and organization.
 *
 * Without this check an admin in org A could pass a company UUID from org B in
 * the same tenant and cross-link a customer user into another org's portal
 * context (#2693). The lookup is org-scoped to match how `CustomerEntity` rows
 * are created and listed.
 */
export async function isOwnedCompanyEntity(
  em: EntityManager,
  customerEntityId: string,
  scope: CustomerEntityScope,
): Promise<boolean> {
  const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: customerEntityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'company',
      deletedAt: null,
    } as any,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return !!entity
}
