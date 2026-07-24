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
  return isOwnedEntityOfKind(em, customerEntityId, 'company', scope)
}

/**
 * Confirms that a caller-supplied `personEntityId` (the CRM person FK linked
 * onto a customer user) exists, is a person, is not soft-deleted, and belongs
 * to the caller's tenant and organization.
 *
 * This is the symmetric guard to {@link isOwnedCompanyEntity}: the person FK is
 * copied onto the customer user on accept and short-circuits CRM auto-linking,
 * so an unvalidated id would permanently cross-link a portal user to another
 * org's person (the #4362/#2693 class of bug, on the person side).
 */
export async function isOwnedPersonEntity(
  em: EntityManager,
  personEntityId: string,
  scope: CustomerEntityScope,
): Promise<boolean> {
  return isOwnedEntityOfKind(em, personEntityId, 'person', scope)
}

async function isOwnedEntityOfKind(
  em: EntityManager,
  customerEntityId: string,
  kind: 'company' | 'person',
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
      kind,
      deletedAt: null,
    } as any,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  return !!entity
}
