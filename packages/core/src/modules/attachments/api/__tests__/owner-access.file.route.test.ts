/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', roles: [] })),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentOrganizationId: jest.fn(async () => 'org-1'),
}))
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

const mockReadThumbnail = jest.fn(async () => Buffer.from('cached secret'))
jest.mock('@open-mercato/core/modules/attachments/lib/thumbnailCache', () => ({
  buildThumbnailCacheKey: () => 'thumb', readThumbnailCache: (...args: unknown[]) => mockReadThumbnail(...args), writeThumbnailCache: jest.fn(),
}))

const mockRead = jest.fn(async () => ({ buffer: Buffer.from('private document text') }))
const mockResolveDriver = jest.fn(async () => ({ read: mockRead }))
const mockAttachment = {
  id: 'attachment-1', entityId: 'documents:document', recordId: 'document-1',
  partitionCode: 'privateAttachments', tenantId: 'tenant-1', organizationId: 'org-1',
  fileName: 'private.txt', mimeType: 'text/plain', fileSize: 21,
  storagePath: 'private.txt', storageMetadata: {} as Record<string, unknown>,
}
const mockPartition = {
  code: 'privateAttachments', isPublic: false,
  accessResolverRequirements: [{ resolverId: 'documents.document-attachments', targetEntity: 'documents:document' }],
}
const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (
    where.id === mockAttachment.id ? mockAttachment : where.code === mockPartition.code ? mockPartition : null
  )),
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => key === 'em' ? mockEm : key === 'storageDriverFactory' ? { resolveForPartition: mockResolveDriver } : key === 'rbacService' ? { loadAcl: async () => ({ isSuperAdmin: false, organizations: null }), getEffectiveFeatures: async () => ['documents.view'] } : null,
  })),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  StorageDriverFactory: class {},
}))

import { GET } from '../file/[id]/route'
import { GET as GET_IMAGE } from '../image/[id]/[[...slug]]/route'
import { registerAttachmentAccessResolvers } from '../../lib/access-registry'

function requestFile() {
  return GET(
    new Request('http://localhost/api/attachments/file/attachment-1?download=1') as Parameters<typeof GET>[0],
    { params: Promise.resolve({ id: mockAttachment.id }) },
  )
}

afterEach(() => { registerAttachmentAccessResolvers([]); jest.useRealTimers() })

describe('host file access with an unavailable owning-module resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    registerAttachmentAccessResolvers([])
    mockAttachment.mimeType = 'text/plain'
    mockAttachment.entityId = 'documents:document'
    mockAttachment.recordId = 'document-1'
    mockAttachment.storageMetadata = {}
  })

  it('denies a same-organization caller before storage when the required Documents provider is disabled', async () => {
    expect((await requestFile()).status).toBe(403)
    expect(mockResolveDriver).not.toHaveBeenCalled()
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('preserves protection for a malformed legacy Documents assignment instead of dropping its owner', async () => {
    mockAttachment.entityId = 'sync_excel:upload'
    mockAttachment.storageMetadata = { assignments: { type: ' documents:document ', id: null } }
    expect((await requestFile()).status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('keeps unrelated owners accessible in the same shared private partition', async () => {
    mockAttachment.entityId = 'sync_excel:upload'
    const response = await requestFile()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('private document text')
  })
})

it('rejects image access before checking the thumbnail cache or reading bytes', async () => {
  mockAttachment.entityId = 'documents:document'
  mockAttachment.storageMetadata = {}
  mockRead.mockClear()
  const response = await GET_IMAGE(new Request('http://localhost/api/attachments/image/attachment-1?width=200') as Parameters<typeof GET_IMAGE>[0], {
    params: Promise.resolve({ id: mockAttachment.id }),
  })
  expect(response.status).toBe(403)
  expect(mockReadThumbnail).not.toHaveBeenCalled()
  expect(mockRead).not.toHaveBeenCalled()
})

it('never caches a protected successful byte response', async () => {
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
    id: 'documents.document-attachments', targetPartition: '*', targetEntity: 'documents:document', resolve: async () => ({ ok: true }),
  }] }])
  mockAttachment.entityId = 'documents:document'
  const response = await requestFile()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})

it('returns a bounded 504 without storage access on a stalled owner resolver', async () => {
  jest.useFakeTimers()
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
    id: 'documents.document-attachments', targetPartition: '*', timeoutMs: 10, resolve: () => new Promise(() => undefined),
  }] }])
  mockAttachment.entityId = 'documents:document'
  mockRead.mockClear()
  const pending = requestFile()
  await jest.advanceTimersByTimeAsync(20)
  expect((await pending).status).toBe(504)
  expect(mockRead).not.toHaveBeenCalled()
})

describe('protected public response caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPartition.isPublic = true
    mockAttachment.entityId = 'documents:document'
    mockAttachment.recordId = 'document-1'
    mockAttachment.storageMetadata = {}
    mockAttachment.mimeType = 'image/png'
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [{
      id: 'documents.document-attachments', targetPartition: '*', targetEntity: 'documents:document',
      resolve: async () => ({ ok: true }),
    }] }])
  })
  afterEach(() => {
    mockPartition.isPublic = false
    mockAttachment.mimeType = 'text/plain'
  })

  it('overrides public file caching after the owning policy allows', async () => {
    const response = await requestFile()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('private document text')
    expect(mockRead).toHaveBeenCalledTimes(1)
  })

  it('overrides public image caching even when the thumbnail cache is warm', async () => {
    const response = await GET_IMAGE(new Request('http://localhost/api/attachments/image/attachment-1?width=200') as Parameters<typeof GET_IMAGE>[0], {
      params: Promise.resolve({ id: mockAttachment.id }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('cached secret')
    expect(mockReadThumbnail).toHaveBeenCalledTimes(1)
    expect(mockRead).not.toHaveBeenCalled()
  })
})
