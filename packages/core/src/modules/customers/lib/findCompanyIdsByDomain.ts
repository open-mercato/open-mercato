import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { CustomerCompanyProfile } from '../data/entities'
import { normalizeCompanyDomain } from './companyDomain'

export const COMPANY_DOMAIN_LOOKUP_LIMIT = 10_000

export type CompanyDomainLookupScope = {
  tenantId: string | null
  organizationIds: readonly string[] | null
  selectedOrganizationId: string | null
  decryptionOrganizationId: string | null
  includeDeleted: boolean
}

export type CompanyDomainLookupResult =
  | { status: 'ok'; companyIds: string[] }
  | { status: 'scope-too-large'; limit: number }

export async function findCompanyIdsByDomain(
  em: EntityManager,
  domain: string,
  scope: CompanyDomainLookupScope,
): Promise<CompanyDomainLookupResult> {
  const scanEm = em.fork()
  const where: Record<string, unknown> = { tenantId: scope.tenantId, domain: { $ne: null } }
  if (Array.isArray(scope.organizationIds)) where.organizationId = { $in: scope.organizationIds }
  else if (scope.selectedOrganizationId) where.organizationId = scope.selectedOrganizationId
  if (!scope.includeDeleted) where.entity = { deletedAt: null }
  const profiles: CustomerCompanyProfile[] = await findWithDecryption(
    scanEm,
    CustomerCompanyProfile,
    where as FilterQuery<CustomerCompanyProfile>,
    {
      fields: ['id', 'domain', 'entity', 'tenantId', 'organizationId'],
      limit: COMPANY_DOMAIN_LOOKUP_LIMIT + 1,
    },
    { tenantId: scope.tenantId, organizationId: scope.decryptionOrganizationId },
  )
  if (profiles.length > COMPANY_DOMAIN_LOOKUP_LIMIT) {
    return { status: 'scope-too-large', limit: COMPANY_DOMAIN_LOOKUP_LIMIT }
  }
  const undecryptableCount = profiles.filter((profile) => isEncryptedPayloadShape(profile.domain)).length
  if (undecryptableCount > 0) {
    throw new Error(`[internal] company domain lookup could not decrypt ${undecryptableCount} candidate profiles`)
  }
  return {
    status: 'ok',
    companyIds: profiles
      .filter((profile) => normalizeCompanyDomain(profile.domain) === domain && profile.entity?.id)
      .map((profile) => profile.entity.id),
  }
}
