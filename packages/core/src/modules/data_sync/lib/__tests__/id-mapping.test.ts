import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createExternalIdMappingService } from '../id-mapping'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
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

    const persist = jest.fn((_entity: unknown) => ({ flush: jest.fn().mockResolvedValue(undefined) }))
    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persist,
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
    // Update path must not call em.persist(created).flush() — it should use em.flush() only.
    expect(persist).not.toHaveBeenCalled()
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

    const persist = jest.fn((_entity: unknown) => ({ flush: jest.fn().mockResolvedValue(undefined) }))
    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      persist,
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
    expect(persist).not.toHaveBeenCalled()
  })

  describe('deleteExternalIdMapping', () => {
    it('soft-deletes the matching mapping and returns true', async () => {
      const existing = {
        id: 'mapping-1',
        integrationId: 'sync_magento',
        internalEntityType: 'sales_order',
        internalEntityId: 'order-1',
        externalId: 'magento-1',
        deletedAt: null as Date | null,
      }
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(existing)

      const em = { flush: jest.fn().mockResolvedValue(undefined) }
      const service = createExternalIdMappingService(em as never)
      const result = await service.deleteExternalIdMapping(
        'sync_magento',
        'sales_order',
        'order-1',
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )

      expect(result).toBe(true)
      expect(existing.deletedAt).toBeInstanceOf(Date)
      expect(em.flush).toHaveBeenCalledTimes(1)
      const where = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
      expect(where).toMatchObject({
        integrationId: 'sync_magento',
        internalEntityType: 'sales_order',
        internalEntityId: 'order-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      })
    })

    it('returns false and does not flush when no mapping exists', async () => {
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce(null)

      const em = { flush: jest.fn().mockResolvedValue(undefined) }
      const service = createExternalIdMappingService(em as never)
      const result = await service.deleteExternalIdMapping(
        'sync_magento',
        'sales_order',
        'order-missing',
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )

      expect(result).toBe(false)
      expect(em.flush).not.toHaveBeenCalled()
    })
  })

  describe('deleteExternalIdMappings', () => {
    it('soft-deletes every matching mapping and returns the count', async () => {
      const rows = [
        { id: 'mapping-1', internalEntityId: 'order-1', deletedAt: null as Date | null },
        { id: 'mapping-2', internalEntityId: 'order-2', deletedAt: null as Date | null },
      ]
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce(rows)

      const em = { flush: jest.fn().mockResolvedValue(undefined) }
      const service = createExternalIdMappingService(em as never)
      const result = await service.deleteExternalIdMappings(
        'sync_magento',
        'sales_order',
        ['order-1', 'order-2', 'order-1'],
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )

      expect(result).toBe(2)
      expect(rows[0].deletedAt).toBeInstanceOf(Date)
      expect(rows[1].deletedAt).toBeInstanceOf(Date)
      expect(em.flush).toHaveBeenCalledTimes(1)
      const where = (findWithDecryption as jest.Mock).mock.calls[0][2]
      expect(where.internalEntityId).toEqual({ $in: ['order-1', 'order-2'] })
    })

    it('returns 0 without querying or flushing for an empty id list', async () => {
      const em = { flush: jest.fn().mockResolvedValue(undefined) }
      const service = createExternalIdMappingService(em as never)
      const result = await service.deleteExternalIdMappings(
        'sync_magento',
        'sales_order',
        [],
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )

      expect(result).toBe(0)
      expect(findWithDecryption as jest.Mock).not.toHaveBeenCalled()
      expect(em.flush).not.toHaveBeenCalled()
    })

    it('returns 0 and does not flush when nothing matches', async () => {
      ;(findWithDecryption as jest.Mock).mockResolvedValueOnce([])

      const em = { flush: jest.fn().mockResolvedValue(undefined) }
      const service = createExternalIdMappingService(em as never)
      const result = await service.deleteExternalIdMappings(
        'sync_magento',
        'sales_order',
        ['order-x'],
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )

      expect(result).toBe(0)
      expect(em.flush).not.toHaveBeenCalled()
    })
  })
})
