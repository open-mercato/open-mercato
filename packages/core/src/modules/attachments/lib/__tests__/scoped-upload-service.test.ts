import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { StorageDriverFactory } from '../drivers'
import type { AttachmentQuotaService } from '../quota-service'
import {
  isScopedAttachmentUploadError,
  ScopedAttachmentUploadError,
  ScopedAttachmentUploadService,
} from '../scoped-upload-service'

jest.mock('../partitions', () => ({
  ensureDefaultPartitions: jest.fn(async () => undefined),
  resolveDefaultPartitionCode: jest.fn(() => 'privateAttachments'),
}))

jest.mock('../ocrQueue', () => ({ requestOcrProcessing: jest.fn(async () => undefined) }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function makeHarness(options: {
  persistFails?: boolean
  reserveFails?: boolean
  markStoredFails?: boolean
  storedPath?: string
} = {}) {
  const order: string[] = []
  const attachment = {} as Record<string, unknown>
  const tx = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => {
      Object.assign(attachment, values)
      return attachment
    }),
    persist: jest.fn(() => ({
      flush: jest.fn(async () => {
        order.push('persist')
        if (options.persistFails) throw new Error('db unavailable')
      }),
    })),
  }
  const em = {
    findOne: jest.fn(async () => ({
      code: 'privateAttachments',
      storageDriver: 'local',
      requiresOcr: false,
    })),
    transactional: jest.fn(async (work: (inner: typeof tx) => Promise<void>) => work(tx)),
  } as unknown as EntityManager
  const driver = {
    key: 'local',
    prepareStoragePath: jest.fn(() => 'tenant/org/upload.pdf'),
    store: jest.fn(async () => {
      order.push('store')
      return { storagePath: options.storedPath ?? 'tenant/org/upload.pdf' }
    }),
    deleteStrict: jest.fn(async () => {
      order.push('delete')
    }),
  }
  const storageDriverFactory = {
    resolveForPartition: jest.fn(async () => driver),
  } as unknown as StorageDriverFactory
  const quota = {
    reserve: jest.fn(async () => {
      order.push('reserve')
      if (options.reserveFails) throw Object.assign(new Error('quota exceeded'), { code: 'quota_exceeded' })
      return { id: 'reservation-1', leaseToken: 'lease-1', expiresAt: new Date(Date.now() + 60_000) }
    }),
    beginStorage: jest.fn(async () => {
      order.push('begin')
    }),
    markStored: jest.fn(async () => {
      order.push('stored')
      if (options.markStoredFails) throw new Error('quota ledger unavailable')
    }),
    completeAttachment: jest.fn(async () => {
      order.push('complete')
    }),
    release: jest.fn(async () => {
      order.push('release')
    }),
  } as unknown as AttachmentQuotaService
  const dataEngine = {
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  } as unknown as DataEngine
  const scheduler = jest.fn(async () => undefined)
  const service = new ScopedAttachmentUploadService({
    em,
    dataEngine,
    storageDriverFactory,
    attachmentQuotaService: quota,
    attachmentQuotaRecoveryScheduler: scheduler,
  })
  return { service, order, attachment, driver, quota, dataEngine, em }
}

const input = {
  tenantId,
  organizationId,
  entityId: 'warranty_claims:warranty_claim',
  recordId: '33333333-3333-4333-8333-333333333333',
  fileName: 'damage.pdf',
  declaredMimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.7 sample'),
  tags: ['warranty_claims:customer-visible'],
}

describe('ScopedAttachmentUploadService', () => {
  it('reserves quota before storage and completes it in the persistence transaction', async () => {
    const { service, order, attachment, dataEngine, em } = makeHarness()

    await expect(service.upload(input)).resolves.toBe(attachment)

    expect(order).toEqual(['reserve', 'begin', 'store', 'stored', 'persist', 'complete'])
    expect(attachment).toMatchObject({
      tenantId,
      organizationId,
      entityId: input.entityId,
      recordId: input.recordId,
      storagePath: 'tenant/org/upload.pdf',
    })
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created' }))
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      code: 'privateAttachments',
      $or: [
        { tenantId: null, organizationId: null },
        { tenantId, organizationId },
      ],
    })
  })

  it('deletes stored content and releases quota when database persistence fails', async () => {
    const { service, order, driver, quota, dataEngine } = makeHarness({ persistFails: true })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'persistence_failed',
      status: 500,
    }))

    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant/org/upload.pdf')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
    expect(order).toEqual(['reserve', 'begin', 'store', 'stored', 'persist', 'delete', 'release'])
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })

  it('deletes the path returned by storage when the quota ledger cannot mark it stored', async () => {
    const { service, driver, quota } = makeHarness({
      markStoredFails: true,
      storedPath: 'tenant/org/driver-selected-upload.pdf',
    })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'storage_failed',
      status: 500,
    }))

    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant/org/driver-selected-upload.pdf')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
  })

  it('fails before storage when quota reservation is rejected', async () => {
    const { service, driver } = makeHarness({ reserveFails: true })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'quota_exceeded',
      status: 413,
    }))
    expect(driver.store).not.toHaveBeenCalled()
  })
})

describe('ScopedAttachmentUploadError bundle-safe identity', () => {
  // The production build emits this module into several server chunks, so a
  // route's `instanceof` compares against a different copy of the class than the
  // DI-resolved service threw from. The check then fails silently, the error
  // escapes the caller's catch, and a deliberate 400 surfaces as a 500
  // (TC-WC-028, shard 13). Only the `Symbol.for` marker survives duplication.
  class DuplicateChunkCopy extends Error {
    readonly [Symbol.for('@open-mercato/ScopedAttachmentUploadError')] = true
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code)
      this.name = 'ScopedAttachmentUploadError'
    }
  }

  it('recognizes an error thrown by another copy of the class', () => {
    const fromOtherChunk = new DuplicateChunkCopy('dangerous_executable', 400)

    expect(fromOtherChunk instanceof ScopedAttachmentUploadError).toBe(false)
    expect(isScopedAttachmentUploadError(fromOtherChunk)).toBe(true)
  })

  it('recognizes errors thrown by this copy of the class', () => {
    expect(isScopedAttachmentUploadError(new ScopedAttachmentUploadError('dangerous_executable', 400))).toBe(true)
  })

  it('does not claim unrelated errors or values', () => {
    expect(isScopedAttachmentUploadError(new Error('nope'))).toBe(false)
    expect(isScopedAttachmentUploadError({ code: 'dangerous_executable', status: 400 })).toBe(false)
    expect(isScopedAttachmentUploadError(null)).toBe(false)
    expect(isScopedAttachmentUploadError(undefined)).toBe(false)
  })
})

describe('ScopedAttachmentUploadService — vector images', () => {
  const logo = '<?xml version="1.0"?>\n<!-- exported -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>'
  const vectorInput = {
    ...input,
    fileName: 'logo.svg',
    declaredMimeType: 'image/svg+xml',
    buffer: Buffer.from(logo, 'utf8'),
  }

  it('rejects an SVG as active content by default', async () => {
    const { service, order } = makeHarness()

    await expect(service.upload(vectorInput)).rejects.toMatchObject({ code: 'active_content', status: 400 })
    expect(order).toEqual([])
  })

  it('stores the sanitised document, its size and the vector record when opted in', async () => {
    const { service, attachment, driver, quota } = makeHarness()

    await service.upload({ ...vectorInput, allowVectorImage: true })

    const stored = (driver.store.mock.calls[0] as unknown as [{ buffer: Buffer }])[0].buffer
    expect(stored.toString('utf8')).not.toContain('exported')
    expect(stored.toString('utf8')).toContain('fill="#123456"')
    expect(quota.reserve).toHaveBeenCalledWith(expect.objectContaining({ bytes: stored.length }))
    expect(attachment).toMatchObject({
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
      fileSize: stored.length,
      storageMetadata: expect.objectContaining({
        tags: input.tags,
        vectorImage: expect.objectContaining({
          sanitizer: 'dompurify',
          policyVersion: 1,
          sha256: createHash('sha256').update(stored).digest('hex'),
        }),
      }),
    })
  })

  it('names an extension-less SVG with .svg', async () => {
    const { service, attachment } = makeHarness()

    await service.upload({ ...vectorInput, fileName: 'logo', allowVectorImage: true })

    expect(attachment).toMatchObject({ fileName: 'logo.svg', mimeType: 'image/svg+xml' })
  })

  it('rejects a hostile SVG with its reason before any quota or storage work', async () => {
    const { service, order } = makeHarness()
    const hostile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8')

    await expect(service.upload({ ...vectorInput, buffer: hostile, allowVectorImage: true })).rejects.toMatchObject({
      code: 'vector_image_unsafe_content',
      status: 400,
    })
    expect(order).toEqual([])
  })

  it('keeps rejecting other active content even when vector images are allowed', async () => {
    const { service, order } = makeHarness()
    const svgInHtml = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')

    await expect(service.upload({
      ...vectorInput,
      fileName: 'logo.html',
      declaredMimeType: 'image/svg+xml',
      buffer: svgInHtml,
      allowVectorImage: true,
    })).rejects.toMatchObject({ code: 'active_content', status: 400 })
    await expect(service.upload({
      ...vectorInput,
      fileName: 'page.xhtml',
      buffer: Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"/>', 'utf8'),
      allowVectorImage: true,
    })).rejects.toMatchObject({ code: 'active_content', status: 400 })
    expect(order).toEqual([])
  })

  it('still refuses executable extensions and oversized files before the vector path', async () => {
    const { service } = makeHarness()

    await expect(service.upload({ ...vectorInput, fileName: 'logo.exe', allowVectorImage: true }))
      .rejects.toMatchObject({ code: 'dangerous_executable' })
    await expect(service.upload({ ...vectorInput, maxBytes: 4, allowVectorImage: true }))
      .rejects.toMatchObject({ code: 'max_upload_size' })
  })

  it('still refuses a public partition when a private one is required', async () => {
    const { service, em } = makeHarness()
    ;(em.findOne as jest.Mock).mockResolvedValueOnce({ code: 'privateAttachments', storageDriver: 'local', isPublic: true })

    await expect(service.upload({ ...vectorInput, allowVectorImage: true, requirePrivatePartition: true }))
      .rejects.toMatchObject({ code: 'partition_unavailable', status: 403 })
  })
})
