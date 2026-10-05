import { createRequire } from 'node:module'
import { MikroORM } from '@mikro-orm/postgresql'
import type { SyncExternalIdMapping as ExternalIdMappingEntity } from '@open-mercato/core/modules/integrations/data/entities'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'

const { SyncExternalIdMapping } = createRequire(import.meta.url)('@open-mercato/core/modules/integrations/data/entities') as {
  SyncExternalIdMapping: new () => ExternalIdMappingEntity
}

export async function createExternalIdsFixture(input: {
  organizationId: string
  tenantId: string
  entityType: string
  entityId: string
  integrationId: string
  externalId: string
}) {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('[internal] The integration runner must supply its target app DATABASE_URL for scoped ORM fixtures')
  }
  if (!input.organizationId || !input.tenantId) {
    throw new Error('[internal] Scoped integration fixtures require token organization and tenant IDs')
  }
  const orm = await MikroORM.init({ entities: [SyncExternalIdMapping], clientUrl: resolveIntegrationDatabaseUrl() })
  const em = orm.em.fork()
  const mapping = em.create(SyncExternalIdMapping, {
    integrationId: input.integrationId,
    internalEntityType: input.entityType,
    internalEntityId: input.entityId,
    externalId: input.externalId,
    syncStatus: 'synced',
    organizationId: input.organizationId,
    tenantId: input.tenantId,
  })
  let removed = false
  try {
    await em.persist(mapping).flush()
  } catch (error) {
    await orm.close()
    throw error
  }
  const remove = async () => {
    if (removed) return
    await em.remove(mapping).flush()
    removed = true
  }
  return {
    async update(externalId: string) {
      mapping.externalId = externalId
      await em.flush()
    },
    remove,
    async close() {
      try {
        await remove()
      } finally {
        await orm.close()
      }
    },
  }
}
