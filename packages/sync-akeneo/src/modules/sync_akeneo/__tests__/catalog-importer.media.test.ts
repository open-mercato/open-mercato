import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { createAkeneoImporter } from '../lib/catalog-importer'
import { buildDefaultAkeneoMapping, type AkeneoDataMapping, type AkeneoProduct } from '../lib/shared'

const mockContainerResolve = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockRemoveAttachmentRecord = jest.fn()
const mockDeletePartitionFile = jest.fn()
const mockEmitCrudSideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: mockContainerResolve,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/storageReferences', () => ({
  removeAttachmentRecord: (...args: unknown[]) => mockRemoveAttachmentRecord(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  deletePartitionFile: (...args: unknown[]) => mockDeletePartitionFile(...args),
  storePartitionFile: jest.fn(async () => {
    throw new Error('[internal] no upload expected in test')
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: (...args: unknown[]) => mockEmitCrudSideEffects(...args),
}))

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const PRODUCT_ID = 'product-1'
const KEPT_EXTERNAL_ID = 'product:image:main_image:kept.png:0'

function storedAttachment(id: string, externalId: string): Attachment {
  return {
    id,
    entityId: 'catalog:catalog_product',
    recordId: PRODUCT_ID,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    partitionCode: 'productsMedia',
    storageDriver: 'local',
    storagePath: `org-1/tenant-1/${id}.png`,
    storageMetadata: { source: 'akeneo', externalId, kind: 'image' },
  } as unknown as Attachment
}

function createMediaWorld(attachments: Attachment[]) {
  const commandBus = {
    execute: jest.fn(async (commandId: string, { input }: { input: Record<string, unknown> }) => {
      switch (commandId) {
        case 'catalog.products.create':
          return { result: { productId: PRODUCT_ID } }
        case 'catalog.products.update':
          return { result: { productId: input.id } }
        case 'catalog.variants.create':
          return { result: { variantId: 'variant-1' } }
        case 'catalog.variants.update':
          return { result: { variantId: input.id } }
        default:
          throw new Error(`[internal] unexpected command: ${commandId}`)
      }
    }),
  }
  const externalIdMappingService = {
    lookupLocalId: jest.fn(async (_integrationId: string, entityType: string, externalId: string) => (
      entityType === 'attachment' && externalId === KEPT_EXTERNAL_ID ? 'attachment-kept' : null
    )),
    lookupExternalId: jest.fn(async () => null),
    storeExternalIdMapping: jest.fn(async () => undefined),
  }
  const dataEngine = { flushOrmEntityChanges: jest.fn(async () => undefined) }

  mockContainerResolve.mockImplementation((key: string) => {
    if (key === 'em') return {}
    if (key === 'commandBus') return commandBus
    if (key === 'dataEngine') return dataEngine
    if (key === 'externalIdMappingService') return externalIdMappingService
    if (key === 'cache') throw new Error('[internal] no cache in test')
    throw new Error(`[internal] unexpected dependency: ${key}`)
  })
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogProduct && where.id === PRODUCT_ID) return { id: PRODUCT_ID, deletedAt: null }
    if (entity === CatalogProductVariant && where.product === PRODUCT_ID) return { id: 'variant-1', product: PRODUCT_ID }
    return null
  })
  mockFindWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === Attachment) return attachments.filter((attachment) => attachment.recordId === where.recordId)
    return []
  })

  const client = {
    getFamily: jest.fn(async () => null),
    getFamilyVariant: jest.fn(async () => null),
    getAttribute: jest.fn(async (code: string) => (
      code === 'main_image'
        ? { code, type: 'pim_catalog_image', localizable: false, scopable: false, labels: {} }
        : null
    )),
    getProductModel: jest.fn(async () => null),
    downloadMediaFile: jest.fn(async () => {
      throw new Error('[internal] no download expected in test')
    }),
  }
  return { client }
}

function buildMediaMapping(): AkeneoDataMapping {
  const base = buildDefaultAkeneoMapping('products')
  const products = base.settings?.products
  if (!products) throw new Error('[internal] default Akeneo product mapping is missing')
  return {
    ...base,
    settings: {
      ...base.settings,
      products: {
        ...products,
        priceMappings: [],
        mediaMappings: [{ attributeCode: 'main_image', target: 'product', kind: 'image' }],
        customFieldMappings: [],
        syncAssociations: false,
        createMissingChannels: false,
        reconciliation: { ...products.reconciliation, deleteMissingMedia: true },
      },
    },
  }
}

const product: AkeneoProduct = {
  uuid: 'uuid-mug',
  identifier: 'MUG',
  parent: null,
  enabled: true,
  values: {
    sku: [{ locale: null, scope: null, data: 'MUG' }],
    main_image: [{ locale: null, scope: null, data: 'kept.png' }],
  },
}

describe('akeneo catalog importer media reconciliation', () => {
  beforeEach(() => {
    mockContainerResolve.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
    mockRemoveAttachmentRecord.mockReset()
    mockDeletePartitionFile.mockReset()
    mockEmitCrudSideEffects.mockReset()
  })

  it('removes a stale media row but keeps the stored file another attachment row still references', async () => {
    const stale = storedAttachment('attachment-stale', 'product:image:main_image:old.png:0')
    const world = createMediaWorld([storedAttachment('attachment-kept', KEPT_EXTERNAL_ID), stale])
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: true, releaseStorage: false })
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.upsertProduct(product, buildMediaMapping())

    expect(mockRemoveAttachmentRecord).toHaveBeenCalledTimes(1)
    expect(mockRemoveAttachmentRecord).toHaveBeenCalledWith(expect.anything(), stale)
    expect(mockDeletePartitionFile).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted', entity: stale }))
  })

  it('deletes the stored file after the row only when it was the last reference', async () => {
    const stale = storedAttachment('attachment-stale', 'product:image:main_image:old.png:0')
    const world = createMediaWorld([stale])
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: true, releaseStorage: true })
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.upsertProduct(product, buildMediaMapping())

    expect(mockDeletePartitionFile).toHaveBeenCalledWith('productsMedia', 'org-1/tenant-1/attachment-stale.png', 'local')
    expect(mockRemoveAttachmentRecord.mock.invocationCallOrder[0])
      .toBeLessThan(mockDeletePartitionFile.mock.invocationCallOrder[0])
  })

  it('skips the file and the deleted event when a concurrent delete already removed the row', async () => {
    const stale = storedAttachment('attachment-stale', 'product:image:main_image:old.png:0')
    const world = createMediaWorld([stale])
    mockRemoveAttachmentRecord.mockResolvedValue({ removed: false, releaseStorage: false })
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.upsertProduct(product, buildMediaMapping())

    expect(mockDeletePartitionFile).not.toHaveBeenCalled()
    expect(mockEmitCrudSideEffects).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))
  })
})
