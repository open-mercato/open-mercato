/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'] })),
}))

// Serving routes scope by the selected-organization (#3765), not raw auth.orgId.
// Default to the auth home org so existing assertions hold; override per test.
const mockResolveAttachmentOrganizationId = jest.fn(async (_container: unknown, auth: any) => auth?.orgId ?? null)
jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentOrganizationId: (...args: unknown[]) => mockResolveAttachmentOrganizationId(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/access', () => ({
  checkAttachmentAccess: jest.fn(() => ({ ok: true })),
  isSuperAdminAuth: jest.fn(() => false),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/security', () => ({
  buildAttachmentContentDisposition: jest.fn(() => 'inline; filename="file.txt"'),
  canRenderInlineAttachment: jest.fn(() => true),
}))

const mockAttachment = {
  id: 'att-1',
  mimeType: 'text/plain',
  partitionCode: 'privateAttachments',
  storagePath: 'stored/file.txt',
  fileName: 'file.txt',
  fileSize: 4,
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const mockPartition = {
  code: 'privateAttachments',
  isPublic: false,
}

const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    if (where.id === 'att-1') return mockAttachment
    if (where.code === 'privateAttachments') return mockPartition
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => key === 'em' ? mockEm : null,
  })),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  StorageDriverFactory: class {
    resolveForPartition() {
      return { read: jest.fn(async () => ({ buffer: Buffer.from('data') })) }
    }
  },
}))

type FileRoute = typeof import('../file/[id]/route')

describe('attachments file route', () => {
  let GET: FileRoute['GET']

  beforeAll(async () => {
    GET = (await import('../file/[id]/route')).GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAttachmentOrganizationId.mockImplementation(async (_container: unknown, auth: any) => auth?.orgId ?? null)
  })

  it('scopes the lookup to the currently selected organization, not the uploader home org (#3765)', async () => {
    // A multi-org admin viewing an attachment stored under the selected org:
    // auth.orgId stays 'org-1' (home) but the request scope resolves the selected org.
    mockResolveAttachmentOrganizationId.mockResolvedValueOnce('selected-org')

    const response = await GET(
      new Request('http://localhost/api/attachments/file/att-1') as Parameters<FileRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne.mock.calls[0][1]).toMatchObject({
      id: 'att-1',
      tenantId: 'tenant-1',
      organizationId: 'selected-org',
    })
    const { checkAttachmentAccess } = await import('@open-mercato/core/modules/attachments/lib/access') as any
    expect(checkAttachmentAccess).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'selected-org' }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('returns 404 when authenticated non-super-admin queries cross-tenant attachment (query layer blocks before access check)', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server') as any
    getAuthFromRequest.mockResolvedValueOnce({ tenantId: 'other-tenant', orgId: 'other-org', roles: ['admin'] })

    // em.findOne returns null because tenantId filter won't match the attachment's tenant
    mockEm.findOne.mockImplementationOnce(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id === 'att-1' && where.tenantId === 'tenant-1') return mockAttachment
      return null
    })

    const response = await GET(
      new Request('http://localhost/api/attachments/file/att-1') as Parameters<FileRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(404)
    // Verify em.findOne was called WITH the caller's tenant scope — this is the defence-in-depth assertion
    expect(mockEm.findOne.mock.calls[0][1]).toMatchObject({
      id: 'att-1',
      tenantId: 'other-tenant',
      organizationId: 'other-org',
    })
    // checkAttachmentAccess must NOT have been called — 404 came from the query layer
    const { checkAttachmentAccess } = await import('@open-mercato/core/modules/attachments/lib/access') as any
    expect(checkAttachmentAccess).not.toHaveBeenCalled()
  })
})
