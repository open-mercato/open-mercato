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

/**
 * Resolves the CRM company a person belongs to, but only when both the profile
 * lookup and the company itself stay inside the given tenant/organization scope.
 * Returns null when the person has no company or that company is out of scope.
 *
 * Both the invite route and the CRM auto-link subscriber need this answer, and
 * both write the result into `customerEntityId` — the portal company scope key —
 * so they must agree on what counts as an in-scope company.
 */
export async function resolveOwnedCompanyForPerson(
  em: EntityManager,
  personEntityId: string,
  scope: CustomerEntityScope,
): Promise<string | null> {
  const { CustomerPersonProfile } = await import('@open-mercato/core/modules/customers/data/entities')
  const profile = await em.findOne(CustomerPersonProfile as any, {
    entity: personEntityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as any)
  const candidate = readCompanyEntityId(profile)
  if (!candidate) return null
  return (await isOwnedCompanyEntity(em, candidate, scope)) ? candidate : null
}

/**
 * `CustomerPersonProfile.company` is a relation on `company_entity_id`, not a
 * scalar — MikroORM hands back either the raw id or an entity reference, never a
 * `companyEntityId` property. Reading the wrong one silently yields undefined and
 * turns every company recovery into a clear.
 */
function readCompanyEntityId(profile: unknown): string | null {
  const company = (profile as { company?: unknown } | null | undefined)?.company
  if (!company) return null
  if (typeof company === 'string') return company
  const id = (company as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

async function isOwnedEntityOfKind(
  em: EntityManager,
  entityId: string,
  kind: 'company' | 'person',
  scope: CustomerEntityScope,
): Promise<boolean> {
  const { CustomerEntity } = await import('@open-mercato/core/modules/customers/data/entities')
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    {
      id: entityId,
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
