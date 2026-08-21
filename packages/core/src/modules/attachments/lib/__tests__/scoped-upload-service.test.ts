import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { StorageDriverFactory } from '../drivers'
import type { AttachmentQuotaService } from '../quota-service'
import { AttachmentScanError, type AttachmentScanReceipt } from '../scanning'
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
  scanRejects?: boolean
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
  const attachmentScanGate = {
    scan: jest.fn(async (request: { buffer: Buffer }) => {
      order.push('scan')
      const receipt: AttachmentScanReceipt = {
        status: options.scanRejects ? 'rejected' : 'clean',
        scanner: 'test-scanner',
        policy: 'required',
        checkedAt: '2026-08-27T12:00:00.000Z',
        contentSha256: createHash('sha256').update(request.buffer).digest('hex'),
        reasonCode: options.scanRejects ? 'malware_detected' : null,
      }
      if (options.scanRejects) throw new AttachmentScanError('rejected', receipt)
      return receipt
    }),
  }
  const service = new ScopedAttachmentUploadService({
    em,
    dataEngine,
    storageDriverFactory,
    attachmentQuotaService: quota,
    attachmentQuotaRecoveryScheduler: scheduler,
    attachmentScanGate,
  })
  return { service, order, attachment, driver, quota, dataEngine, em, attachmentScanGate }
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

    expect(order).toEqual(['scan', 'reserve', 'begin', 'store', 'stored', 'persist', 'complete'])
    expect(attachment).toMatchObject({
      tenantId,
      organizationId,
      entityId: input.entityId,
      recordId: input.recordId,
      storagePath: 'tenant/org/upload.pdf',
      storageMetadata: expect.objectContaining({
        securityScan: expect.objectContaining({ status: 'clean', scanner: 'test-scanner' }),
      }),
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
    expect(order).toEqual(['scan', 'reserve', 'begin', 'store', 'stored', 'persist', 'delete', 'release'])
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

  it('rejects suspicious bytes before quota reservation or storage', async () => {
    const { service, driver, quota } = makeHarness({ scanRejects: true })

    await expect(service.upload(input)).rejects.toEqual(expect.objectContaining<Partial<ScopedAttachmentUploadError>>({
      code: 'scan_rejected',
      status: 422,
    }))
    expect(quota.reserve).not.toHaveBeenCalled()
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
