import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncExternalIdMapping } from '../../integrations/data/entities'

type MappingScope = {
  organizationId: string
  tenantId: string
}

export function createExternalIdMappingService(em: EntityManager) {
  return {
    async lookupLocalId(integrationId: string, entityType: string, externalId: string, scope: MappingScope): Promise<string | null> {
      const row = await findOneWithDecryption(
        em,
        SyncExternalIdMapping,
        {
        integrationId,
        internalEntityType: entityType,
        externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        },
        undefined,
        scope,
      )
      return row?.internalEntityId ?? null
    },

    async lookupExternalId(integrationId: string, entityType: string, localId: string, scope: MappingScope): Promise<string | null> {
      const row = await findOneWithDecryption(
        em,
        SyncExternalIdMapping,
        {
        integrationId,
        internalEntityType: entityType,
        internalEntityId: localId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        },
        undefined,
        scope,
      )
      return row?.externalId ?? null
    },

    async storeExternalIdMapping(
      integrationId: string,
      entityType: string,
      localId: string,
      externalId: string,
      scope: MappingScope,
    ): Promise<SyncExternalIdMapping> {
      const existingByLocalId = await findOneWithDecryption(
        em,
        SyncExternalIdMapping,
        {
        integrationId,
        internalEntityType: entityType,
        internalEntityId: localId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        },
        undefined,
        scope,
      )

      const existingByExternalId = await findOneWithDecryption(
        em,
        SyncExternalIdMapping,
        {
        integrationId,
        internalEntityType: entityType,
        externalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
        },
        undefined,
        scope,
      )

      const existing = existingByExternalId ?? existingByLocalId

      if (existing) {
        const now = new Date()
        existing.internalEntityId = localId
        existing.externalId = externalId
        existing.syncStatus = 'synced'
        existing.lastSyncedAt = now
        existing.deletedAt = null
        if (
          existingByExternalId &&
          existingByLocalId &&
          existingByExternalId.id !== existingByLocalId.id
        ) {
          const duplicate = existing.id === existingByExternalId.id
            ? existingByLocalId
            : existingByExternalId
          duplicate.deletedAt = now
        }
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
