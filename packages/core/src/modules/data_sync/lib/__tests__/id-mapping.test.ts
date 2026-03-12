import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createExternalIdMappingService } from '../id-mapping'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

describe('createExternalIdMappingService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rebinds an existing external id mapping to a recreated local record', async () => {
    const existingByExternalId = {
      id: 'mapping-1',
      integrationId: 'sync_akeneo',
      internalEntityType: 'catalog_product',
      internalEntityId: 'product-old',
      externalId: 'akeneo-1',
      syncStatus: 'error',
      lastSyncedAt: null,
      deletedAt: null,
    }
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingByExternalId)

    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
    }

    const service = createExternalIdMappingService(em as never)
    const result = await service.storeExternalIdMapping(
      'sync_akeneo',
      'catalog_product',
      'product-new',
      'akeneo-1',
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )

    expect(result).toBe(existingByExternalId)
    expect(existingByExternalId.internalEntityId).toBe('product-new')
    expect(existingByExternalId.externalId).toBe('akeneo-1')
    expect(existingByExternalId.syncStatus).toBe('synced')
    expect(existingByExternalId.lastSyncedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.persistAndFlush).not.toHaveBeenCalled()
  })

  it('retires duplicate active rows when both local and external lookups resolve different mappings', async () => {
    const existingByLocalId = {
      id: 'mapping-local',
      integrationId: 'sync_akeneo',
      internalEntityType: 'catalog_product',
      internalEntityId: 'product-new',
      externalId: 'akeneo-old',
      syncStatus: 'synced',
      lastSyncedAt: null,
      deletedAt: null,
    }
    const existingByExternalId = {
      id: 'mapping-external',
      integrationId: 'sync_akeneo',
      internalEntityType: 'catalog_product',
      internalEntityId: 'product-old',
      externalId: 'akeneo-1',
      syncStatus: 'error',
      lastSyncedAt: null,
      deletedAt: null,
    }
    ;(findOneWithDecryption as jest.Mock)
      .mockResolvedValueOnce(existingByLocalId)
      .mockResolvedValueOnce(existingByExternalId)

    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
    }

    const service = createExternalIdMappingService(em as never)
    await service.storeExternalIdMapping(
      'sync_akeneo',
      'catalog_product',
      'product-new',
      'akeneo-1',
      {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    )

    expect(existingByExternalId.internalEntityId).toBe('product-new')
    expect(existingByExternalId.syncStatus).toBe('synced')
    expect(existingByLocalId.deletedAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
