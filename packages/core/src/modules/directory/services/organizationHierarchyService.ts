import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '../data/entities'

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)))
}

export class DefaultOrganizationHierarchyService implements OrganizationHierarchyService {
  constructor(private readonly em: EntityManager) {}

  async resolveAncestorIds(input: {
    tenantId: string
    organizationId: string
  }): Promise<string[] | null> {
    const organization = await findOneWithDecryption(
      this.em,
      Organization,
      {
        id: input.organizationId,
        tenant: input.tenantId,
        deletedAt: null,
      } as FilterQuery<Organization>,
      { fields: ['id', 'ancestorIds'] },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    return organization ? normalizeIds(organization.ancestorIds) : null
  }
}
