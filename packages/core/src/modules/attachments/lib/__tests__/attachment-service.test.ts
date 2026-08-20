import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { DefaultAttachmentService } from '../attachment-service'
import type { StorageDriverFactory } from '../drivers'
import type { AttachmentQuotaService } from '../quota-service'
import { ScopedAttachmentUploadService } from '../scoped-upload-service'

jest.mock('kysely', () => ({
  sql: Object.assign(
    () => ({
      as: () => 'total_size',
      execute: async () => undefined,
    }),
    {},
  ),
}))

jest.mock('../partitions', () => ({
  ensureDefaultPartitions: jest.fn(async () => undefined),
  resolveDefaultPartitionCode: jest.fn(() => 'privateAttachments'),
}))

jest.mock('../ocrQueue', () => ({ requestOcrProcessing: jest.fn(async () => undefined) }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) =>
    em.findOne(...args),
}))

const scopedAuth = {
  tenantId: 'tenant-1',
  orgId: 'org-1',
  userId: 'user-1',
  roles: [],
} as any

function partition(overrides: Record<string, unknown> = {}) {
  return {
    code: 'privateAttachments',
    storageDriver: 'local',
    configJson: null,
    isPublic: false,
    ...overrides,
  } as AttachmentPartition
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-1',
    entityId: 'documents:document',
    recordId: 'document-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    partitionCode: 'privateAttachments',
    storageDriver: 'local',
    storagePath: 'tenant-1/org-1/file.txt',
    storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-1' }] },
    fileName: 'file.txt',
    mimeType: 'text/plain',
    fileSize: 4,
    ...overrides,
  } as Attachment
}

function matchesScopedWhere(record: Attachment, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const candidate = record as unknown as Record<string, unknown>
  return Object.entries(where as Record<string, unknown>).every(([key, value]) => candidate[key] === value)
}

function createHarness(options: {
  usage?: number
  partition?: AttachmentPartition
  attachment?: Attachment | null
  storeError?: Error
  readError?: Error
  /**
   * Simulates a regression that drops the scope columns from the Attachment
   * lookup, so the authorization layer can be exercised on its own.
   */
  unscopedAttachmentLookup?: boolean
  /** Error the delegated scoped upload service raises. */
  uploadError?: unknown
  /** Simulates a container without the scoped upload service registered. */
  withoutScopedUpload?: boolean
} = {}) {
  const selectedPartition = options.partition ?? partition()
  const selectedAttachment = options.attachment === undefined ? attachment() : options.attachment
  const driver = {
    key: 'test',
    store: jest.fn(async () => {
      if (options.storeError) throw options.storeError
      return { storagePath: 'tenant-1/org-1/stored.txt' }
    }),
    read: jest.fn(async () => {
      if (options.readError) throw options.readError
      return { buffer: Buffer.from('file'), contentType: 'text/plain' }
    }),
    delete: jest.fn(async () => undefined),
    toLocalPath: jest.fn(),
  }
  const db = {
    selectFrom: jest.fn(() => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => ({ total_size: options.usage ?? 0 }),
        }),
      }),
    })),
  }
  let inTransaction = false
  const em: any = {
    findOne: jest.fn(async (entity: unknown, where: unknown) => {
      if (entity === AttachmentPartition) return selectedPartition
      if (entity !== Attachment || !selectedAttachment) return null
      if (options.unscopedAttachmentLookup) return selectedAttachment
      return matchesScopedWhere(selectedAttachment, where) ? selectedAttachment : null
    }),
    getKysely: () => db,
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    isInTransaction: jest.fn(() => inTransaction),
  }
  em.transactional = jest.fn(async (callback: (tx: typeof em) => unknown) => callback(em))
  const factory: any = { resolveForPartition: jest.fn(async () => driver) }
  // `createScoped` delegates the whole upload to the platform's scoped upload
  // service; the double records what it was handed and can fail with any of the
  // service's machine codes.
  const scopedUpload: any = {
    upload: jest.fn(async (uploadInput: Record<string, unknown>) => {
      if (options.uploadError) throw options.uploadError
      await (uploadInput.persistLink as ((tx: unknown, id: string) => Promise<void>) | undefined)?.(em, 'attachment-1')
      return attachment({ fileName: 'stored.txt', mimeType: 'text/plain', fileSize: 4 })
    }),
  }
  const service = new DefaultAttachmentService(em, factory, () => (options.withoutScopedUpload ? null : scopedUpload))
  return { service, em, driver, factory, scopedUpload }
}

/**
 * Wires the *real* `ScopedAttachmentUploadService` behind `DefaultAttachmentService`
 * so the delegate's storage, quota and persistence paths run for real. The other
 * harness stubs `createScoped`'s delegate out entirely, which cannot exercise
 * what the delegate does with an error raised inside `persistLink`.
 */
function createDelegatingHarness() {
  const driver = {
    key: 'local',
    prepareStoragePath: jest.fn(() => 'tenant-1/org-1/upload.txt'),
    store: jest.fn(async () => ({ storagePath: 'tenant-1/org-1/upload.txt' })),
    deleteStrict: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  }
  const transactionEm = {
    create: jest.fn((_entity: unknown, values: Record<string, unknown>) => values),
    persist: jest.fn(() => ({ flush: jest.fn(async () => undefined) })),
  }
  const em = {
    findOne: jest.fn(async () => partition({ requiresOcr: false })),
    transactional: jest.fn(async (work: (tx: unknown) => Promise<void>) => work(transactionEm)),
  } as unknown as EntityManager
  const quota = {
    reserve: jest.fn(async () => ({
      id: 'reservation-1',
      leaseToken: 'lease-1',
      expiresAt: new Date(Date.now() + 60_000),
    })),
    beginStorage: jest.fn(async () => undefined),
    markStored: jest.fn(async () => undefined),
    completeAttachment: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  }
  const factory = { resolveForPartition: jest.fn(async () => driver) } as unknown as StorageDriverFactory
  const uploadService = new ScopedAttachmentUploadService({
    em,
    dataEngine: null,
    storageDriverFactory: factory,
    attachmentQuotaService: quota as unknown as AttachmentQuotaService,
    attachmentQuotaRecoveryScheduler: jest.fn(async () => undefined),
  })
  const service = new DefaultAttachmentService(em, factory, () => uploadService)
  return { service, driver, quota, em }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    entityId: 'documents:document',
    recordId: 'document-1',
    partitionCode: 'privateAttachments',
    fileName: 'file.txt',
    declaredMimeType: 'text/plain',
    buffer: Buffer.from('file'),
    assignments: [{ type: 'documents:document', id: 'document-1' }],
    ...overrides,
  }
}

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toMatchObject<Partial<CrudHttpError>>({ status })
}

describe('DefaultAttachmentService', () => {
  afterEach(() => {
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OM_ATTACHMENT_TENANT_QUOTA_MB
  })

  // `createScoped` used to run its own quota check on a different advisory-lock
  // key that counted only committed rows, so it could not see an in-flight
  // reservation from the public attachment route and the two paths could
  // jointly exceed a tenant's quota. It now delegates to the one service that
  // owns the fenced reservation lease.
  it('delegates the upload to the shared scoped upload service', async () => {
    const { service, scopedUpload, driver } = createHarness()

    await expect(service.createScoped(createInput())).resolves.toMatchObject({
      id: 'attachment-1',
      fileName: 'stored.txt',
      mimeType: 'text/plain',
      fileSize: 4,
    })

    expect(scopedUpload.upload).toHaveBeenCalledTimes(1)
    // No second quota mechanism and no direct provider write from this service.
    expect(driver.store).not.toHaveBeenCalled()
  })

  it('requires a private partition and forwards the module link callback', async () => {
    const { service, scopedUpload } = createHarness()
    const persistLink = jest.fn(async () => undefined)

    await service.createScoped(createInput({ persistLink }))

    expect(scopedUpload.upload).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityId: 'documents:document',
      recordId: 'document-1',
      partitionCode: 'privateAttachments',
      requirePrivatePartition: true,
      persistLink,
    }))
    // The link must be written inside the delegate's transaction.
    expect(persistLink).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['quota_exceeded', 413],
    ['quota_target_exists', 409],
    ['dangerous_executable', 400],
    ['active_content', 400],
    ['storage_failed', 500],
    ['persistence_failed', 500],
  ] as const)('maps the delegated %s failure to %i', async (code, status) => {
    const uploadError = Object.assign(new Error(code), {
      code,
      status,
      [Symbol.for('@open-mercato/ScopedAttachmentUploadError')]: true,
    })
    const { service } = createHarness({ uploadError })

    await expectStatus(service.createScoped(createInput()), status)
  })

  it('rethrows a non-upload error unchanged', async () => {
    const { service } = createHarness({ uploadError: new Error('database unavailable') })

    await expect(service.createScoped(createInput())).rejects.toThrow('database unavailable')
  })

  it('refuses to upload when the scoped upload service is not registered', async () => {
    const { service, driver } = createHarness({ withoutScopedUpload: true })

    await expectStatus(service.createScoped(createInput()), 500)

    expect(driver.store).not.toHaveBeenCalled()
  })

  // Every other test in this file — and every Documents-side test — replaces
  // `createScoped`'s delegate with a double, so none of them reach the real
  // persistence catch. This one wires the actual upload service in, because the
  // regression it guards lived there: the catch discarded the caught error and
  // reported `persistence_failed` (500) for a 403 the caller raised on purpose
  // inside `persistLink`.
  it('preserves a 403 raised inside persistLink and still compensates storage', async () => {
    const { service, driver, quota } = createDelegatingHarness()
    const persistLink = jest.fn(async () => {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    })

    await expect(service.createScoped(createInput({ persistLink }))).rejects.toMatchObject({
      status: 403,
      body: { error: 'Forbidden' },
    })

    expect(persistLink).toHaveBeenCalledTimes(1)
    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant-1/org-1/upload.txt')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
  })

  it('still reports a genuine persistence failure as a 500', async () => {
    const { service, driver, quota } = createDelegatingHarness()
    const persistLink = jest.fn(async () => {
      throw new Error('db unavailable')
    })

    await expectStatus(service.createScoped(createInput({ persistLink })), 500)

    expect(driver.deleteStrict).toHaveBeenCalledWith('privateAttachments', 'tenant-1/org-1/upload.txt')
    expect(quota.release).toHaveBeenCalledWith('reservation-1', 'lease-1')
  })

  it('scopes the attachment lookup to the caller tenant and organization', async () => {
    const { service, em, factory } = createHarness({
      attachment: attachment({ tenantId: 'tenant-2', organizationId: 'org-2' }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 404)

    const attachmentLookup = em.findOne.mock.calls.find(([entity]: unknown[]) => entity === Attachment)
    expect(attachmentLookup?.[1]).toEqual({
      id: 'attachment-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('still rejects a foreign-scope row when the scoped lookup filter regresses', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({ tenantId: 'tenant-2', organizationId: 'org-2' }),
      unscopedAttachmentLookup: true,
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 403)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('does not let an isSuperAdmin flag read an attachment outside the requested scope', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({ tenantId: 'tenant-2', organizationId: 'org-2' }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: { ...scopedAuth, isSuperAdmin: true },
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 404)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('does not let a superadmin role name read an attachment outside the requested scope', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({ tenantId: 'tenant-2', organizationId: 'org-2' }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: { ...scopedAuth, roles: ['superadmin'] },
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 404)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('does not serve a global attachment row to a tenant-scoped caller', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({ tenantId: null, organizationId: null }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 404)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('rejects a public partition when a private module partition is required', async () => {
    const { service, factory } = createHarness({ partition: partition({ isPublic: true }) })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      requirePrivatePartition: true,
    }), 403)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('rejects a partition owned by another tenant before reading storage', async () => {
    const { service, factory } = createHarness({
      partition: partition({ tenantId: 'tenant-2', organizationId: 'org-2' }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 403)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('rejects an attachment whose owner assignment does not match the document', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({
        storageMetadata: { assignments: [{ type: 'documents:document', id: 'document-2' }] },
      }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      expectedAssignment: { type: 'documents:document', id: 'document-1' },
    }), 404)

    expect(factory.resolveForPartition).not.toHaveBeenCalled()
  })

  it('maps storage read failures to a not-found response', async () => {
    const { service } = createHarness({ readError: new Error('provider unavailable') })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      expectedAssignment: { type: 'documents:document', id: 'document-1' },
    }), 404)
  })

  it('rejects a chunked multipart body once the bounded stream exceeds the cap', async () => {
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '0.001'
    const { service } = createHarness()
    const boundary = 'bounded-upload'
    const chunk = new Uint8Array(600_000)
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk)
          controller.enqueue(chunk)
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    await expectStatus(service.readUploadForm(request), 413)
  })

  it('rejects malformed content-length before reading multipart bytes', async () => {
    const { service } = createHarness()
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=bad-length',
        'content-length': 'invalid',
      },
      body: 'ignored',
    })

    await expectStatus(service.readUploadForm(request), 413)
  })

  it('releases an exactly-owned attachment from storage and quota accounting', async () => {
    const { service, driver, em } = createHarness()

    await service.releaseScoped({
      attachmentId: 'attachment-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      expectedAssignment: { type: 'documents:document', id: 'document-1' },
      expectedPartitionCode: 'privateAttachments',
    })

    expect(driver.delete).toHaveBeenCalledWith('privateAttachments', 'tenant-1/org-1/file.txt')
    expect(em.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachment-1' }))
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.flush.mock.invocationCallOrder[0]).toBeLessThan(driver.delete.mock.invocationCallOrder[0])
  })

  it('does not release an attachment carrying another assignment', async () => {
    const { service, driver, em } = createHarness({
      attachment: attachment({
        storageMetadata: {
          assignments: [
            { type: 'documents:document', id: 'document-1' },
            { type: 'messages:message', id: 'message-1' },
          ],
        },
      }),
    })

    await expectStatus(service.releaseScoped({
      attachmentId: 'attachment-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      expectedAssignment: { type: 'documents:document', id: 'document-1' },
    }), 409)

    expect(driver.delete).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })

  // `expectedAssignment` is a required field, but this service is resolved
  // through untyped DI and consumed through structural ports in other packages,
  // so an omitted assignment must fail closed rather than destroy an attachment
  // another record still links to.
  it('refuses to release when no expected assignment proves exclusive ownership', async () => {
    const { service, driver, em } = createHarness({
      attachment: attachment({
        storageMetadata: {
          assignments: [
            { type: 'documents:document', id: 'document-1' },
            { type: 'messages:message', id: 'message-1' },
          ],
        },
      }),
    })
    const releaseWithoutAssignment = {
      attachmentId: 'attachment-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    } as Parameters<typeof service.releaseScoped>[0]

    await expectStatus(service.releaseScoped(releaseWithoutAssignment), 500)

    expect(driver.delete).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('defers provider deletion until the owning transaction commits', async () => {
    const { service, driver, em } = createHarness()
    let cleanup: (() => Promise<void>) | void = undefined

    await withAtomicFlush(em, [async () => {
      cleanup = await service.releaseScoped({
        attachmentId: 'attachment-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
        expectedAssignment: { type: 'documents:document', id: 'document-1' },
      }, { em, flush: false })
      expect(driver.delete).not.toHaveBeenCalled()
    }], { transaction: true, label: 'attachments.release' })

    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(driver.delete).not.toHaveBeenCalled()
    expect(cleanup).toEqual(expect.any(Function))
    await cleanup!()
    expect(driver.delete).toHaveBeenCalledTimes(1)
    expect(em.commit.mock.invocationCallOrder[0]).toBeLessThan(driver.delete.mock.invocationCallOrder[0])
  })

  it('never deletes provider bytes when a later transaction phase rolls back', async () => {
    const { service, driver, em } = createHarness()
    let cleanup: (() => Promise<void>) | void = undefined

    await expect(withAtomicFlush(em, [
      async () => { cleanup = await service.releaseScoped({
        attachmentId: 'attachment-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
        expectedAssignment: { type: 'documents:document', id: 'document-1' },
      }, { em, flush: false }) },
      () => { throw new Error('later document mutation failed') },
    ], { transaction: true, label: 'attachments.release' })).rejects.toThrow('later document mutation failed')

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(cleanup).toEqual(expect.any(Function))
    expect(driver.delete).not.toHaveBeenCalled()
  })

  it('rejects immediate release inside an ambient transaction', async () => {
    const { service, driver, em } = createHarness()
    await em.begin()

    await expectStatus(service.releaseScoped({
      attachmentId: 'attachment-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
      expectedAssignment: { type: 'documents:document', id: 'document-1' },
    }), 500)

    expect(em.remove).not.toHaveBeenCalled()
    expect(driver.delete).not.toHaveBeenCalled()
  })
})
