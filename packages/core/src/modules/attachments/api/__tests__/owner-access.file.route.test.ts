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
    resolve: (key: string) => key === 'em' ? mockEm : key === 'storageDriverFactory' ? { resolveForPartition: mockResolveDriver } : null,
  })),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  StorageDriverFactory: class {},
}))

import { GET } from '../file/[id]/route'

function requestFile() {
  return GET(
    new Request('http://localhost/api/attachments/file/attachment-1?download=1') as Parameters<typeof GET>[0],
    { params: Promise.resolve({ id: mockAttachment.id }) },
  )
}

describe('host file access with an unavailable owning-module resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
