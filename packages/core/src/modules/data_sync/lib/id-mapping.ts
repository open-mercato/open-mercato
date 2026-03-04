import type { EntityManager } from '@mikro-orm/postgresql'
import { SyncExternalIdMapping } from '../../integrations/data/entities'

type MappingScope = {
  organizationId: string
  tenantId: string
}

export function createExternalIdMappingService(em: EntityManager) {
  return {
    async lookupLocalId(integrationId: string, entityType: string, externalId: string, scope: MappingScope): Promise<string | null> {
      const row = await em.findOne(SyncExternalIdMapping, {
        integrationId,
        internalEntityType: entityType,
        externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      return row?.internalEntityId ?? null
    },

    async lookupExternalId(integrationId: string, entityType: string, localId: string, scope: MappingScope): Promise<string | null> {
      const row = await em.findOne(SyncExternalIdMapping, {
        integrationId,
        internalEntityType: entityType,
        internalEntityId: localId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      return row?.externalId ?? null
    },

    async storeExternalIdMapping(
      integrationId: string,
      entityType: string,
      localId: string,
      externalId: string,
      scope: MappingScope,
    ): Promise<SyncExternalIdMapping> {
      const existing = await em.findOne(SyncExternalIdMapping, {
        integrationId,
        internalEntityType: entityType,
        internalEntityId: localId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      })

      if (existing) {
        existing.externalId = externalId
        existing.syncStatus = 'synced'
        existing.lastSyncedAt = new Date()
        await em.flush()
        return existing
      }

      const created = em.create(SyncExternalIdMapping, {
        integrationId,
        internalEntityType: entityType,
        internalEntityId: localId,
        externalId,
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })

      await em.persistAndFlush(created)
      return created
    },
  }
}

export type ExternalIdMappingService = ReturnType<typeof createExternalIdMappingService>
