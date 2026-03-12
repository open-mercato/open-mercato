import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncMapping } from '@open-mercato/core/modules/data_sync/data/entities'
import { buildDefaultAkeneoMapping, normalizeAkeneoMapping, type AkeneoDataMapping, type AkeneoEntityType } from './shared'

type MappingScope = {
  organizationId: string
  tenantId: string
}

export async function loadAkeneoMapping(
  em: EntityManager,
  entityType: AkeneoEntityType,
  scope: MappingScope,
): Promise<AkeneoDataMapping> {
  const existing = await findOneWithDecryption(
    em,
    SyncMapping,
    {
      integrationId: 'sync_akeneo',
      entityType,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (!existing) {
    return buildDefaultAkeneoMapping(entityType)
  }

  return normalizeAkeneoMapping(entityType, existing.mapping)
}
