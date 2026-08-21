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

// Only the `attributes` walk resolves a second mapping through DI; the categories and products
// walks use `input.mapping`, so these two mocks are inert for every other case in this file.
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => ({}) })),
}))

jest.mock('../lib/mapping', () => ({
  loadAkeneoMapping: jest.fn(async () => ({ entityType: 'products', fields: [], matchStrategy: 'externalId', settings: {} })),
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

  it('stops the product walk mid-page when the signal aborts, without yielding or reconciling', async () => {
    const controller = new AbortController()
    const listProducts = jest.fn(async () => ({
      items: [
        { uuid: 'product-1', identifier: 'sku-1', family: 'shirts', updated: '2026-03-11 12:00:00' },
        { uuid: 'product-2', identifier: 'sku-2', family: 'shirts', updated: '2026-03-11 12:01:00' },
      ],
      nextUrl: null,
      totalEstimate: 2,
    }))
    // Cancel lands while the first product is being upserted.
    const upsertProduct = jest.fn(async () => {
      controller.abort()
      return [{ externalId: 'product-1', action: 'create', data: { localProductId: 'local-product-1' } }]
    })
    const reconcileProducts = jest.fn(async () => undefined)

    ;(createAkeneoClient as jest.Mock).mockReturnValue({ listProducts })
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
      signal: controller.signal,
    })) {
      batches.push(batch)
    }

    // The return sits above the yield, so the abandoned page is never emitted and the engine never
    // commits a cursor past products it did not apply.
    expect(batches).toEqual([])
    expect(upsertProduct).toHaveBeenCalledTimes(1)
    // A partial walk has not seen every product, so reconciling would delete live records.
    expect(reconcileProducts).not.toHaveBeenCalled()
  })

  it('stops the category walk mid-page when the signal aborts, without yielding or reconciling', async () => {
    const controller = new AbortController()
    const listCategories = jest.fn(async () => ({
      items: [{ code: 'category-1', parent: null }, { code: 'category-2', parent: null }],
      nextUrl: null,
      totalEstimate: 2,
    }))
    const upsertCategory = jest.fn(async () => {
      controller.abort()
      return { localId: 'local-category-1', action: 'create' as const }
    })
    const reconcileCategories = jest.fn(async () => undefined)

    ;(createAkeneoClient as jest.Mock).mockReturnValue({ listCategories })
    ;(createAkeneoImporter as jest.Mock).mockResolvedValue({ upsertCategory, reconcileCategories })

    const batches: ImportBatch[] = []
    for await (const batch of akeneoDataSyncAdapter.streamImport!({
      entityType: 'categories',
      batchSize: 100,
      credentials: {},
      mapping: { entityType: 'categories', fields: [], matchStrategy: 'externalId' },
      scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
      signal: controller.signal,
    })) {
      batches.push(batch)
    }

    expect(batches).toEqual([])
    expect(upsertCategory).toHaveBeenCalledTimes(1)
    // reconcileCategories deletes categories the walk did not see — fatal after a partial walk.
    expect(reconcileCategories).not.toHaveBeenCalled()
  })

  it('stops the attribute-family walk mid-page when the signal aborts, without yielding or reconciling', async () => {
    const controller = new AbortController()
    const listFamilies = jest.fn(async () => ({
      items: [{ code: 'family-1' }, { code: 'family-2' }],
      nextUrl: null,
      totalEstimate: 2,
    }))
    const upsertAttributeFamily = jest.fn(async () => {
      controller.abort()
      return { items: [], action: 'create' as const }
    })
    const reconcileAttributes = jest.fn(async () => undefined)

    ;(createAkeneoClient as jest.Mock).mockReturnValue({ listFamilies })
    ;(createAkeneoImporter as jest.Mock).mockResolvedValue({
      upsertAttributeFamily,
      reconcileAttributes,
      syncMappedCustomFields: jest.fn(async () => []),
      reconcileMappedCustomFieldFieldsets: jest.fn(async () => undefined),
    })

    const batches: ImportBatch[] = []
    for await (const batch of akeneoDataSyncAdapter.streamImport!({
      entityType: 'attributes',
      batchSize: 100,
      credentials: {},
      mapping: { entityType: 'attributes', fields: [], matchStrategy: 'externalId' },
      scope: { organizationId: 'org-1', tenantId: 'tenant-1' },
      signal: controller.signal,
    })) {
      batches.push(batch)
    }

    expect(batches).toEqual([])
    expect(upsertAttributeFamily).toHaveBeenCalledTimes(1)
    expect(reconcileAttributes).not.toHaveBeenCalled()
  })
})
