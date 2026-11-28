import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '../data/entities'
import { organizationSlugFilter } from './organizationSlug'

type DomainMappingResolver = {
  resolveByHostname(hostname: string): Promise<{
    tenantId: string
    organizationId: string
    status: string
  } | null>
}

export async function resolvePortalOrganization(container: AppContainer, slug: string, host: string | null) {
  if (!slug) return null

  const resolver = host
    ? container.resolve<DomainMappingResolver | undefined>('domainMappingService', { allowUnregistered: true })
    : undefined
  const mapping = host && resolver ? await resolver.resolveByHostname(host) : null
  const domainScope = mapping?.status === 'active'
    ? { id: mapping.organizationId, tenant: mapping.tenantId }
    : undefined

  const em = container.resolve<EntityManager>('em')
  const organizations = await findWithDecryption(
    em,
    Organization,
    {
      ...organizationSlugFilter(slug),
      deletedAt: null,
      ...domainScope,
    },
    { limit: 2 },
    { tenantId: domainScope?.tenant, organizationId: domainScope?.id },
  )
  const [organization] = organizations
  if (organizations.length !== 1 || organization?.slug !== slug) return null

  return {
    id: String(organization.id),
    tenantId: String(organization.tenant.id),
    name: organization.name,
    slug,
  }
}
