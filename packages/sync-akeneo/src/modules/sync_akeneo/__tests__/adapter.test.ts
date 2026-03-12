jest.mock('../lib/client', () => {
  const actual = jest.requireActual('../lib/client')
  return {
    ...actual,
    createAkeneoClient: jest.fn(),
  }
})

jest.mock('../lib/catalog-importer', () => ({
  createAkeneoImporter: jest.fn(),
}))

import type { ImportBatch } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { akeneoDataSyncAdapter } from '../lib/adapter'
import { createAkeneoClient } from '../lib/client'
import { createAkeneoImporter } from '../lib/catalog-importer'

describe('akeneo adapter product import', () => {
  it('continues after a single product failure and emits a failed import item', async () => {
    const listProducts = jest.fn(async () => ({
      items: [
        { uuid: 'product-1', identifier: 'sku-1', family: 'shirts', updated: '2026-03-11 12:00:00' },
        { uuid: 'product-2', identifier: 'sku-2', family: 'shirts', updated: '2026-03-11 12:01:00' },
      ],
      nextUrl: null,
      totalEstimate: 2,
    }))
    const upsertProduct = jest
      .fn()
      .mockRejectedValueOnce(new Error('Akeneo media file missing-image.jpg was not found'))
      .mockResolvedValueOnce([
        {
          externalId: 'product-2',
          action: 'create',
          data: { localProductId: 'local-product-2' },
        },
        {
          externalId: 'product-2:default',
          action: 'create',
          data: { localVariantId: 'local-variant-2' },
        },
      ])
    const reconcileProducts = jest.fn(async () => undefined)

    ;(createAkeneoClient as jest.Mock).mockReturnValue({
      listProducts,
    })
    ;(createAkeneoImporter as jest.Mock).mockResolvedValue({
      upsertProduct,
      reconcileMappedCustomFieldFieldsets: jest.fn(async () => undefined),
      reconcileProducts,
    })

    const batches: ImportBatch[] = []
    for await (const batch of akeneoDataSyncAdapter.streamImport!({
      entityType: 'products',
      batchSize: 100,
      credentials: {},
      mapping: {
        entityType: 'products',
        fields: [],
        matchStrategy: 'externalId',
      },
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    })) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(2)
    expect(batches[0]?.items).toEqual([
      {
        externalId: 'product-1',
        action: 'failed',
        data: {
          errorMessage: 'Akeneo media file missing-image.jpg was not found',
          sourceProductUuid: 'product-1',
          sourceIdentifier: 'sku-1',
          sourceParentCode: null,
          family: 'shirts',
        },
      },
      {
        externalId: 'product-2',
        action: 'create',
        data: { localProductId: 'local-product-2' },
      },
      {
        externalId: 'product-2:default',
        action: 'create',
        data: { localVariantId: 'local-variant-2' },
      },
    ])
    expect(batches[0]?.processedCount).toBe(2)
    expect(batches[1]).toEqual(expect.objectContaining({
      items: [],
      processedCount: 0,
      message: 'Reconciling imported Akeneo products after the final batch',
    }))
    expect(listProducts).toHaveBeenCalledWith(expect.objectContaining({
      batchSize: 10,
    }))
    expect(reconcileProducts).toHaveBeenCalled()
  })
})
