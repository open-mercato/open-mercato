import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Attachment, AttachmentPartition } from '../../data/entities'
import { DefaultAttachmentService } from '../attachment-service'

jest.mock('kysely', () => ({
  sql: Object.assign(
    () => ({
      as: () => 'total_size',
      execute: async () => undefined,
    }),
    {},
  ),
}))

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

function createHarness(options: {
  usage?: number
  partition?: AttachmentPartition
  attachment?: Attachment | null
  storeError?: Error
  readError?: Error
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
  const em: any = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === AttachmentPartition) return selectedPartition
      if (entity === Attachment) return selectedAttachment
      return null
    }),
    getKysely: () => db,
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.transactional = jest.fn(async (callback: (tx: typeof em) => unknown) => callback(em))
  const factory: any = { resolveForPartition: jest.fn(async () => driver) }
  return { service: new DefaultAttachmentService(em, factory), em, driver, factory }
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
    delete process.env.OM_ATTACHMENT_TENANT_QUOTA_MB
  })

  it('rejects quota exhaustion before writing to the provider', async () => {
    process.env.OM_ATTACHMENT_TENANT_QUOTA_MB = '1'
    const { service, driver } = createHarness({ usage: 1024 * 1024 })

    await expectStatus(service.createScoped(createInput()), 413)

    expect(driver.store).not.toHaveBeenCalled()
  })

  it('propagates provider failures without attempting cleanup for an unstored blob', async () => {
    const { service, driver } = createHarness({ storeError: new Error('provider unavailable') })

    await expect(service.createScoped(createInput())).rejects.toThrow('provider unavailable')

    expect(driver.delete).not.toHaveBeenCalled()
  })

  it('deletes a stored blob when the module link transaction fails', async () => {
    const { service, driver } = createHarness()

    await expect(service.createScoped(createInput({
      persistLink: async () => { throw new Error('link insert failed') },
    }))).rejects.toThrow('link insert failed')

    expect(driver.delete).toHaveBeenCalledWith('privateAttachments', 'tenant-1/org-1/stored.txt')
  })

  it('rejects a cross-scope read before resolving the provider', async () => {
    const { service, factory } = createHarness({
      attachment: attachment({ tenantId: 'tenant-2', organizationId: 'org-2' }),
    })

    await expectStatus(service.readScoped({
      attachmentId: 'attachment-1',
      auth: scopedAuth,
      expectedOwner: { entityId: 'documents:document', recordId: 'document-1' },
    }), 403)

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
})
