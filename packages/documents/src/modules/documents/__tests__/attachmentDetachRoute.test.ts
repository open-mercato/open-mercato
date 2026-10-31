import { Document, DocumentAttachment } from '../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ReadScopedAttachmentInput } from '@open-mercato/core/modules/attachments'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { DefaultAttachmentService } from '@open-mercato/core/modules/attachments/lib/attachment-service'
import { StorageDriverFactory, registerExternalStorageDriver, registerStorageDriverValidator } from '@open-mercato/core/modules/attachments/lib/drivers'
import type { StorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers'

jest.mock('#generated/entities.ids.generated', () => ({ E: { attachments: { attachment: 'attachments:attachment' } } }), { virtual: true })
jest.mock('@open-mercato/core/modules/attachments/lib/ocrQueue', () => ({ requestOcrProcessing: jest.fn() }))
jest.mock('@open-mercato/core/modules/attachments/lib/ocrService', () => ({ OcrService: class OcrService {} }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({
  t: (key: string, fallback?: string) => key === 'attachments.errors.storageConfigurationInvalid' ? 'Localized storage unavailable' : fallback ?? key,
  translate: (_key: string, fallback?: string) => fallback,
}) }))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'
const FOREIGN_TENANT_ID = '77777777-7777-4777-8777-777777777777'
const FOREIGN_ORGANIZATION_ID = '88888888-8888-4888-8888-888888888888'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('../lib/platformServices', () => ({
  ...jest.requireActual('../lib/platformServices'),
  resolveOrganizationScopeService: () => ({
    resolve: jest.fn(), resolveFresh: jest.fn(),
    resolveForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
  }),
}))

type AttachmentDetailRoute = typeof import('../api/[id]/attachments/[attachmentId]/route')

let DELETE: AttachmentDetailRoute['DELETE']
let GET: AttachmentDetailRoute['GET']
let features: string[]
let attachmentRecord: { id: string; updatedAt: Date; deletedAt: Date | null } | null
/**
 * Scope the stored association is filed under. The mock only returns it when
 * the route's predicate selects that exact scope, so dropping `tenantId` or
 * `organizationId` from the lookup fails every case in this suite.
 */
let attachmentScope: { tenantId: string; organizationId: string }
let em: { findOne: jest.Mock; find: jest.Mock; flush: jest.Mock }
const executeCommand = jest.fn(async () => ({ result: { id: ATTACHMENT_ID }, logEntry: null }))
const validateUpload = jest.fn()
const createScoped = jest.fn(async () => ({ id: ATTACHMENT_ID }))
const readScoped = jest.fn(async (_input: ReadScopedAttachmentInput) => ({
  buffer: Buffer.from('private document bytes'),
  contentType: 'application/octet-stream',
  contentDisposition: 'inline; filename="document.bin"',
}))

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features,
    organizations: null,
  })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'commandBus') return { execute: executeCommand }
    if (name === 'attachmentService') return { validateUpload, createScoped, readScoped }
    return undefined
  }),
}

beforeAll(async () => {
  const route = await import('../api/[id]/attachments/[attachmentId]/route')
  GET = route.GET
  DELETE = route.DELETE
})

beforeEach(() => {
  jest.clearAllMocks()
  features = ['documents.view', 'documents.edit']
  attachmentRecord = { id: ATTACHMENT_ID, updatedAt: new Date('2026-07-12T10:00:00.000Z'), deletedAt: null }
  attachmentScope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
  em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === DocumentAttachment) {
        if (!attachmentRecord) return null
        const selectsStoredAssociation = where?.documentId === DOCUMENT_ID
          && where?.attachmentId === ATTACHMENT_ID
          && where?.tenantId === attachmentScope.tenantId
          && where?.organizationId === attachmentScope.organizationId
          && where?.deletedAt === null
        return selectsStoredAssociation ? attachmentRecord : null
      }
      if (entity !== Document) return null
      return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        ownerUserId: USER_ID,
        deletedAt: null,
      }
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
  }
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
})

function request(method: 'GET' | 'DELETE' = 'DELETE'): Request {
  return new Request(
    `http://localhost/api/documents/${DOCUMENT_ID}/attachments/${ATTACHMENT_ID}`,
    { method },
  )
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID, attachmentId: ATTACHMENT_ID }) }
}

describe('document attachment detach', () => {
  it.each([
    ['missing partition', null, 'partition_missing'],
    ['unknown driver', { storageDriver: 'unknown', configJson: {} }, 'unknown_driver'],
    ['malformed config', { storageDriver: 'document-storage-test', configJson: 'secret-sentinel' }, 'invalid_config'],
    ['rejected config', { storageDriver: 'document-storage-test', configJson: { bucket: 'secret-sentinel' } }, 'validator_rejected'],
  ] as const)('maps %s through the real attachment service to a redacted localized 503', async (_case, invalid, reason) => {
    const priorPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY
    process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
    const driver: StorageDriver = {
      key: 'document-storage-test', store: jest.fn(), read: jest.fn(), delete: jest.fn(), toLocalPath: jest.fn(),
    }
    const construct = jest.fn(() => driver)
    registerExternalStorageDriver(driver.key, construct)
    const unregister = registerStorageDriverValidator(driver.key, ({ config }) => config.bucket === 'valid')
    const serviceEm = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === AttachmentPartition) return invalid === null ? null : { code: 'privateAttachments', isPublic: false, ...invalid }
        if (entity !== Attachment || where.tenantId !== TENANT_ID || where.organizationId !== ORGANIZATION_ID) return null
        return {
          id: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
          entityId: 'documents:document', recordId: DOCUMENT_ID, partitionCode: 'privateAttachments',
          storagePath: 'private/file', storageMetadata: { assignments: [{ type: 'documents:document', id: DOCUMENT_ID }] },
        }
      }),
      remove: jest.fn(), flush: jest.fn(),
    }
    const service = new DefaultAttachmentService(
      serviceEm as unknown as EntityManager,
      new StorageDriverFactory(serviceEm as unknown as EntityManager),
    )
    readScoped.mockImplementationOnce((input) => service.readScoped(input))
    try {
      const response = await GET(request('GET'), context())
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Localized storage unavailable', code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason })
      expect(construct).not.toHaveBeenCalled()
      expect(driver.read).not.toHaveBeenCalled()
      expect(driver.delete).not.toHaveBeenCalled()
      expect(serviceEm.remove).not.toHaveBeenCalled()
      expect(serviceEm.flush).not.toHaveBeenCalled()
    } finally {
      unregister()
      if (priorPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
      else process.env.OM_ATTACHMENT_STORAGE_POLICY = priorPolicy
    }
  })

  it('prevents browsers from reusing private bytes after access is revoked', async () => {
    const response = await GET(request('GET'), context())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0, must-revalidate')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('expires')).toBe('0')
    expect(readScoped).toHaveBeenCalledWith(expect.objectContaining({
      attachmentId: ATTACHMENT_ID,
      requirePrivatePartition: true,
    }))
    expect(em.findOne).toHaveBeenCalledWith(
      DocumentAttachment,
      {
        documentId: DOCUMENT_ID,
        attachmentId: ATTACHMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        deletedAt: null,
      },
      undefined,
    )
  })

  it('denies private bytes for an association filed under another tenant', async () => {
    attachmentScope = { tenantId: FOREIGN_TENANT_ID, organizationId: ORGANIZATION_ID }

    const response = await GET(request('GET'), context())

    expect(response.status).toBe(404)
    expect(readScoped).not.toHaveBeenCalled()
  })

  it('denies private bytes for an association filed under another organization', async () => {
    attachmentScope = { tenantId: TENANT_ID, organizationId: FOREIGN_ORGANIZATION_ID }

    const response = await GET(request('GET'), context())

    expect(response.status).toBe(404)
    expect(readScoped).not.toHaveBeenCalled()
  })

  it('does not detach an association filed under another organization', async () => {
    attachmentScope = { tenantId: TENANT_ID, organizationId: FOREIGN_ORGANIZATION_ID }

    const response = await DELETE(request(), context())

    expect(response.status).toBe(404)
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('routes permanent deletion through the audited command', async () => {
    const response = await DELETE(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(executeCommand).toHaveBeenCalledWith('documents.attachment.delete', expect.objectContaining({
      input: {
        documentId: DOCUMENT_ID,
        attachmentId: ATTACHMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
    }))
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns 404 when the association is already detached', async () => {
    attachmentRecord = null

    const response = await DELETE(request(), context())

    expect(response.status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a caller without documents.edit', async () => {
    features = ['documents.view']

    const response = await DELETE(request(), context())

    expect(response.status).toBe(403)
    expect(em.flush).not.toHaveBeenCalled()
  })
})
