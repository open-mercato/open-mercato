import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { ScopedAttachmentUploadError } from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createAkeneoImporter } from '../lib/catalog-importer'
import { buildDefaultAkeneoMapping, type AkeneoDataMapping, type AkeneoProduct } from '../lib/shared'

const mockContainerResolve = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockStorePartitionFile = jest.fn()
const mockEmitCrudSideEffects = jest.fn()

jest.mock('@open-mercato/core/modules/attachments/lib/crud', () => ({
  attachmentCrudEvents: {},
  attachmentCrudIndexer: {},
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockContainerResolve })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: (...args: unknown[]) => mockEmitCrudSideEffects(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  storePartitionFile: (...args: unknown[]) => mockStorePartitionFile(...args),
  deletePartitionFile: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/partitions', () => ({
  ensureDefaultPartitions: jest.fn(async () => undefined),
  resolveDefaultPartitionCode: jest.fn(() => 'productsMedia'),
}))

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const MEDIA_ATTRIBUTE = 'gallery'

type UploadInput = {
  tenantId: string
  organizationId: string
  entityId: string
  recordId: string
  fileName: string
  declaredMimeType?: string | null
  buffer: Buffer
}

type UploadedRow = {
  id: string
  entityId: string
  recordId: string
  organizationId: string
  tenantId: string
  fileName: string
  fileSize: number
  url: string
  storageMetadata: Record<string, unknown> | null
}

type MediaBinary = {
  buffer: Buffer
  contentType: string | null
  contentLength: number | null
  fileName: string | null
  code: string | null
}

function createMediaWorld(download: (code: string) => Promise<MediaBinary>) {
  const products: Array<{ id: string }> = []
  const variants: Array<{ id: string; product: string; sku: string; isDefault: boolean }> = []
  const mappings: Array<{ entityType: string; localId: string; externalId: string }> = []
  const uploaded: UploadedRow[] = []
  const flushedSnapshots: Array<Array<Pick<UploadedRow, 'id' | 'url' | 'storageMetadata'>>> = []
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const commandBus = {
    execute: jest.fn(async (commandId: string, { input }: { input: Record<string, unknown> }) => {
      switch (commandId) {
        case 'catalog.products.create': {
          const id = nextId('product')
          products.push({ id })
          return { result: { productId: id } }
        }
        case 'catalog.products.update':
          return { result: { productId: input.id } }
        case 'catalog.variants.create': {
          const id = nextId('variant')
          variants.push({ id, product: String(input.productId), sku: String(input.sku), isDefault: input.isDefault === true })
          return { result: { variantId: id } }
        }
        case 'catalog.variants.update':
          return { result: { variantId: input.id } }
        default:
          throw new Error(`[internal] unexpected command: ${commandId}`)
      }
    }),
  }

  const externalIdMappingService = {
    lookupLocalId: jest.fn(async (_integrationId: string, entityType: string, externalId: string) => (
      mappings.find((row) => row.entityType === entityType && row.externalId === externalId)?.localId ?? null
    )),
    lookupExternalId: jest.fn(async () => null),
    storeExternalIdMapping: jest.fn(async (_integrationId: string, entityType: string, localId: string, externalId: string) => {
      mappings.push({ entityType, localId, externalId })
    }),
  }

  const removed: Array<{ id: string }> = []
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: nextId('raw-attachment') })),
    persist: jest.fn(),
    remove: jest.fn((entity: { id: string }) => {
      removed.push(entity)
      return { flush: async () => undefined }
    }),
    flush: jest.fn(async () => {
      flushedSnapshots.push(uploaded.map((row) => ({ id: row.id, url: row.url, storageMetadata: row.storageMetadata })))
    }),
  }

  const uploadService = {
    upload: jest.fn(async (input: UploadInput) => {
      const row: UploadedRow = {
        id: nextId('attachment'),
        entityId: input.entityId,
        recordId: input.recordId,
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        fileName: input.fileName,
        fileSize: input.buffer.length,
        url: `/api/attachments/file/pending`,
        storageMetadata: { assignments: [{ type: input.entityId, id: input.recordId }] },
      }
      uploaded.push(row)
      return row
    }),
  }

  const integrationLogService = { write: jest.fn(async () => ({})) }
  const attachmentService = { releaseScoped: jest.fn(async () => undefined) }

  mockContainerResolve.mockImplementation((key: string) => {
    if (key === 'integrationLogService') return integrationLogService
    if (key === 'attachmentService') return attachmentService
    if (key === 'em') return em
    if (key === 'commandBus') return commandBus
    if (key === 'dataEngine') return { flushOrmEntityChanges: jest.fn(async () => undefined) }
    if (key === 'externalIdMappingService') return externalIdMappingService
    if (key === 'attachmentScopedUploadService') return uploadService
    if (key === 'cache') throw new Error('[internal] no cache in test')
    throw new Error(`[internal] unexpected dependency: ${key}`)
  })

  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    if (entity === CatalogProduct) return products.find((product) => product.id === where.id) ?? null
    if (entity === CatalogProductVariant) {
      return variants.find((variant) => (
        (where.id === undefined || variant.id === where.id)
        && (where.product === undefined || variant.product === where.product)
        && (where.sku === undefined || variant.sku === where.sku)
        && (where.isDefault === undefined || variant.isDefault === where.isDefault)
      )) ?? null
    }
    return null
  })
  mockFindWithDecryption.mockImplementation(async () => [])
  mockStorePartitionFile.mockImplementation(async (payload: { fileName: string }) => ({
    storagePath: `org_org-1/tenant_tenant-1/${payload.fileName}`,
    absolutePath: `/tmp/${payload.fileName}`,
    fileName: payload.fileName,
  }))

  const client = {
    getFamily: jest.fn(async () => null),
    getFamilyVariant: jest.fn(async () => null),
    getAttribute: jest.fn(async (code: string) => (
      code === MEDIA_ATTRIBUTE
        ? { code: MEDIA_ATTRIBUTE, type: 'pim_catalog_image', localizable: false, scopable: false, labels: {} }
        : null
    )),
    getProductModel: jest.fn(async () => null),
    downloadMediaFile: jest.fn(download),
  }

  return {
    client,
    commandBus,
    uploadService,
    uploaded,
    mappings,
    em,
    flushedSnapshots,
    integrationLogService,
    attachmentService,
    removed,
  }
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
        mediaMappings: [{ attributeCode: MEDIA_ATTRIBUTE, target: 'product', kind: 'image' }],
        customFieldMappings: [],
        syncAssociations: false,
        createMissingChannels: false,
      },
    },
  }
}

function buildProductWithMedia(codes: string[]): AkeneoProduct {
  return {
    uuid: 'uuid-mug',
    identifier: 'MUG',
    parent: null,
    enabled: true,
    values: {
      sku: [{ locale: null, scope: null, data: 'MUG' }],
      [MEDIA_ATTRIBUTE]: [{ locale: null, scope: null, data: codes }],
    },
  }
}

function heroUpdateOf(world: ReturnType<typeof createMediaWorld>) {
  return world.commandBus.execute.mock.calls
    .map(([commandId, payload]) => ({ commandId, input: (payload as { input: Record<string, unknown> }).input }))
    .find((call) => call.commandId === 'catalog.products.update' && 'defaultMediaId' in call.input)
}

function pngBinary(code: string, bytes: number, declaredLength: number | null = bytes): MediaBinary {
  return { buffer: Buffer.alloc(bytes), contentType: 'image/png', contentLength: declaredLength, fileName: `${code}.png`, code }
}

describe('akeneo importer media storage (issue #7233)', () => {
  beforeEach(() => {
    mockContainerResolve.mockReset()
    mockFindOneWithDecryption.mockReset()
    mockFindWithDecryption.mockReset()
    mockStorePartitionFile.mockReset()
    mockEmitCrudSideEffects.mockReset()
    mockEmitCrudSideEffects.mockImplementation(async () => undefined)
  })

  it('stores media through the scoped attachment upload service with the bytes actually received', async () => {
    const world = createMediaWorld(async (code) => pngBinary(code, 10, 1))
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.upsertProduct(buildProductWithMedia(['asset-1']), buildMediaMapping())

    expect(mockStorePartitionFile).not.toHaveBeenCalled()
    expect(world.em.create).not.toHaveBeenCalled()
    expect(world.uploadService.upload).toHaveBeenCalledTimes(1)
    const input = world.uploadService.upload.mock.calls[0]?.[0] as UploadInput
    expect(input).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityId: 'catalog:catalog_product',
      fileName: 'asset-1.png',
      declaredMimeType: 'image/png',
    })
    expect(input.buffer.byteLength).toBe(10)
    expect(world.uploaded[0]?.fileSize).toBe(10)
  })

  it('keeps the image URL, Akeneo metadata and attachment mapping on the uploaded row', async () => {
    const world = createMediaWorld(async (code) => pngBinary(code, 4))
    const importer = await createAkeneoImporter(world.client as never, scope)

    await importer.upsertProduct(buildProductWithMedia(['asset-1']), buildMediaMapping())

    const row = world.uploaded[0]
    expect(row?.url).toBe(`/api/attachments/image/${row?.id}/asset-1.png`)
    expect(row?.storageMetadata).toMatchObject({
      assignments: [{ type: 'catalog:catalog_product', id: row?.recordId }],
      source: 'akeneo',
      kind: 'image',
      remoteCode: 'asset-1',
    })
    expect(world.flushedSnapshots.some((snapshot) => snapshot.some((entry) => entry.id === row?.id && entry.url === row?.url))).toBe(true)
    expect(world.mappings.filter((mapping) => mapping.entityType === 'attachment')).toEqual([
      expect.objectContaining({ localId: row?.id }),
    ])
    const attachmentActions = mockEmitCrudSideEffects.mock.calls
      .map(([args]) => args as { action: string; entity: { id?: string } })
      .filter((args) => args.entity?.id === row?.id)
      .map((args) => args.action)
    expect(attachmentActions).toEqual(['updated'])
  })

  it('fails the product without storing an attachment mapping when attachment storage rejects the media', async () => {
    const world = createMediaWorld(async (code) => pngBinary(code, 4))
    world.uploadService.upload.mockRejectedValueOnce(new ScopedAttachmentUploadError('quota_exceeded', 413))
    const importer = await createAkeneoImporter(world.client as never, scope)

    await expect(importer.upsertProduct(buildProductWithMedia(['asset-1']), buildMediaMapping()))
      .rejects.toThrow('Akeneo media asset-1 was rejected by attachment storage (quota_exceeded)')

    expect(world.mappings.filter((mapping) => mapping.entityType === 'attachment')).toEqual([])
    expect(mockStorePartitionFile).not.toHaveBeenCalled()
  })

  it('skips a media download that exceeds the size limit, logs a warning and keeps importing the product', async () => {
    const tooLarge = Object.assign(new Error('Akeneo response exceeds the 1 byte limit'), { name: 'AkeneoResponseTooLargeError' })
    const world = createMediaWorld(async (code) => {
      if (code === 'asset-1') throw tooLarge
      return pngBinary(code, 4)
    })
    const importer = await createAkeneoImporter(world.client as never, scope)

    const items = await importer.upsertProduct(buildProductWithMedia(['asset-1', 'asset-2']), buildMediaMapping())

    expect(items.length).toBeGreaterThan(0)
    expect(world.uploadService.upload).toHaveBeenCalledTimes(1)
    expect(world.uploaded.map((row) => row.fileName)).toEqual(['asset-2.png'])
    expect(world.mappings.filter((mapping) => mapping.entityType === 'attachment')).toEqual([
      expect.objectContaining({ localId: world.uploaded[0]?.id }),
    ])
    expect(heroUpdateOf(world)?.input.defaultMediaId).toBe(world.uploaded[0]?.id)
    expect(world.integrationLogService.write).toHaveBeenCalledTimes(1)
    expect(world.integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'sync_akeneo',
      level: 'warn',
      code: 'sync_akeneo.media_rejected',
      payload: expect.objectContaining({ remoteCode: 'asset-1', reason: 'max_upload_size' }),
    }), scope)
    expect(mockStorePartitionFile).not.toHaveBeenCalled()
  })

  it.each(['active_content', 'max_upload_size', 'dangerous_executable'] as const)(
    'skips media the attachment policy rejects (%s) without failing the product',
    async (code) => {
      const world = createMediaWorld(async (mediaCode) => pngBinary(mediaCode, 4))
      world.uploadService.upload.mockRejectedValueOnce(new ScopedAttachmentUploadError(code, 400))
      const importer = await createAkeneoImporter(world.client as never, scope)

      await importer.upsertProduct(buildProductWithMedia(['asset-1']), buildMediaMapping())

      expect(world.mappings.filter((mapping) => mapping.entityType === 'attachment')).toEqual([])
      expect(heroUpdateOf(world)?.input.defaultMediaId).toBeNull()
      expect(world.integrationLogService.write).toHaveBeenCalledWith(expect.objectContaining({
        level: 'warn',
        payload: expect.objectContaining({ remoteCode: 'asset-1', reason: code }),
      }), scope)
    },
  )

  it('releases no-longer-desired media through the attachment service and keeps media other records still use', async () => {
    const world = createMediaWorld(async (code) => pngBinary(code, 4))
    const staleRows = ['stale-1', 'stale-shared'].map((id) => ({
      id,
      entityId: 'catalog:catalog_product',
      recordId: 'product-1',
      partitionCode: 'productsMedia',
      storagePath: `org/tenant/${id}.png`,
      storageDriver: 's3',
      storageMetadata: { externalId: id, kind: 'image' },
    }))
    mockFindWithDecryption.mockImplementation(async () => staleRows)
    world.attachmentService.releaseScoped
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => { throw new CrudHttpError(409, { error: 'Attachment is still referenced by another record' }) })
    const importer = await createAkeneoImporter(world.client as never, scope)
    const mapping = buildMediaMapping()
    const products = mapping.settings?.products
    if (!products) throw new Error('[internal] media mapping is missing')
    products.reconciliation = { ...products.reconciliation, deleteMissingMedia: true }

    await importer.upsertProduct(buildProductWithMedia(['asset-1']), mapping)

    expect(world.attachmentService.releaseScoped).toHaveBeenCalledTimes(2)
    expect(world.attachmentService.releaseScoped).toHaveBeenNthCalledWith(1, {
      attachmentId: 'stale-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      expectedOwner: { entityId: 'catalog:catalog_product', recordId: 'product-1' },
      expectedAssignment: { type: 'catalog:catalog_product', id: 'product-1' },
      expectedPartitionCode: 'productsMedia',
    })
    const deletedIds = mockEmitCrudSideEffects.mock.calls
      .map(([args]) => args as { action: string; entity: { id?: string } })
      .filter((args) => args.action === 'deleted')
      .map((args) => args.entity.id)
    expect(deletedIds).toEqual(['stale-1'])
    expect(world.removed).toEqual([])
    expect(mockStorePartitionFile).not.toHaveBeenCalled()
  })

  it('downloads the media files of a product one at a time and keeps the first image as hero', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const world = createMediaWorld(async (code) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return pngBinary(code, 4)
    })
    const importer = await createAkeneoImporter(world.client as never, scope)
    const codes = Array.from({ length: 8 }, (_, index) => `asset-${index + 1}`)

    await importer.upsertProduct(buildProductWithMedia(codes), buildMediaMapping())

    expect(world.client.downloadMediaFile).toHaveBeenCalledTimes(8)
    expect(world.client.downloadMediaFile.mock.calls.map(([code]) => code)).toEqual(codes)
    expect(maxInFlight).toBe(1)
    expect(world.uploaded[0]?.fileName).toBe('asset-1.png')
    expect(heroUpdateOf(world)?.input.defaultMediaId).toBe(world.uploaded[0]?.id)
  })
})
