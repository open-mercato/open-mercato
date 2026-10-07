/** @jest-environment node */

const mockSharp = jest.fn()
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'] })),
}))

// Serving routes scope by the selected-organization (#3765), not raw auth.orgId.
// Default to the auth home org so existing assertions hold; override per test.
type AuthStub = { orgId?: string | null }
const mockResolveAttachmentRequestScope = jest.fn(
  async (_container: unknown, auth: AuthStub | null | undefined) => ({
    denied: false,
    organizationId: auth?.orgId ?? null,
  }),
)
jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentRequestScope: (...args: unknown[]) => mockResolveAttachmentRequestScope(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  resolvePartitionRoot: jest.fn(() => '/tmp'),
  resolveAttachmentAbsolutePath: jest.fn(() => '/tmp/attachment'),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/thumbnailCache', () => ({
  buildThumbnailCacheKey: jest.fn(() => 'w_100'),
  readThumbnailCache: jest.fn(async () => null),
  writeThumbnailCache: jest.fn(async () => undefined),
}))

const mockAttachment = {
  id: 'att-1',
  mimeType: 'image/png',
  partitionCode: 'privateAttachments',
  storagePath: 'stored/image',
  storageDriver: 'local',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const mockPartition = {
  code: 'privateAttachments',
  isPublic: false,
}

const mockStorageRead = jest.fn(async () => ({
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
}))
const mockResolveForPartition = jest.fn(async () => ({ read: mockStorageRead }))

jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({
  StorageDriverFactory: class {
    resolveForPartition() {
      return mockResolveForPartition()
    }
  },
}))

const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: { id?: string; code?: string }) => {
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

type ImageRoute = typeof import('../image/[id]/[[...slug]]/route')

function prepareValidImageRendering() {
  const transformer = {
    metadata: jest.fn(async () => ({ width: 1, height: 1, format: 'png' })),
    resize: jest.fn(),
    toBuffer: jest.fn(async () => Buffer.from('rendered-image')),
  }
  transformer.resize.mockReturnValue(transformer)
  mockSharp.mockReturnValue(transformer)
}

describe('attachments image route', () => {
  let GET: ImageRoute['GET']

  beforeAll(async () => {
    GET = (await import('../image/[id]/[[...slug]]/route')).GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveAttachmentRequestScope.mockImplementation(
      async (_container: unknown, auth: AuthStub | null | undefined) => ({
        denied: false,
        organizationId: auth?.orgId ?? null,
      }),
    )
  })

  it('serves a same-scope private image', async () => {
    prepareValidImageRendering()

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne.mock.calls[0][1]).toEqual({
      id: 'att-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockStorageRead).toHaveBeenCalledWith('privateAttachments', 'stored/image')
  })

  it('scopes the lookup to the currently selected organization, not the uploader home org (#3765)', async () => {
    // A multi-org admin viewing a thumbnail stored under the selected org:
    // auth.orgId stays 'org-1' (home) but the request scope resolves the selected org.
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: false, organizationId: 'selected-org' })
    mockEm.findOne.mockImplementationOnce(async () => null)

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(404)
    expect(mockEm.findOne.mock.calls[0][1]).toMatchObject({
      id: 'att-1',
      tenantId: 'tenant-1',
      organizationId: 'selected-org',
    })
  })

  it('keeps tenant and organization predicates for a spoofed superadmin role and never reaches storage', async () => {
    const { getAuthFromRequest } = await import(
      '@open-mercato/shared/lib/auth/server'
    ) as { getAuthFromRequest: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce({
      tenantId: 'other-tenant',
      orgId: 'other-org',
      roles: ['superadmin'],
      isSuperAdmin: false,
    })

    mockEm.findOne.mockImplementationOnce(async (_entity: unknown, where: Record<string, unknown>) => {
      if (where.id !== 'att-1') return null
      if ('tenantId' in where && where.tenantId !== mockAttachment.tenantId) return null
      if ('organizationId' in where && where.organizationId !== mockAttachment.organizationId) return null
      return mockAttachment
    })

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(404)
    // Verify em.findOne was called WITH the caller's tenant scope — this is the defence-in-depth assertion
    expect(mockEm.findOne.mock.calls[0][1]).toMatchObject({
      id: 'att-1',
      tenantId: 'other-tenant',
      organizationId: 'other-org',
    })
    expect(mockResolveForPartition).not.toHaveBeenCalled()
    expect(mockStorageRead).not.toHaveBeenCalled()
  })

  it('preserves unscoped lookup and storage access for a canonical superadmin', async () => {
    const { getAuthFromRequest } = await import(
      '@open-mercato/shared/lib/auth/server'
    ) as { getAuthFromRequest: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce({
      tenantId: 'other-tenant',
      orgId: 'other-org',
      roles: [],
      isSuperAdmin: true,
    })
    prepareValidImageRendering()

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne.mock.calls[0][1]).toEqual({ id: 'att-1' })
    expect(mockStorageRead).toHaveBeenCalledWith('privateAttachments', 'stored/image')
  })

  it('rejects spoofed image content before invoking sharp', async () => {
    mockStorageRead.mockResolvedValueOnce({ buffer: Buffer.from('RIFF0000WEBP', 'ascii') })

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1?width=100') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Image MIME type does not match file content',
    })
    expect(mockSharp).not.toHaveBeenCalled()
  })
})
