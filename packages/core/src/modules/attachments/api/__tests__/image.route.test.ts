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
  tenantId: 'tenant-1' as string | null,
  organizationId: 'org-1' as string | null,
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

  it.each([
    { name: 'scoped public', tenantId: 'tenant-1', organizationId: 'org-1', isPublic: true, anonymous: false, expected: 'private, max-age=60' },
    { name: 'scoped private', tenantId: 'tenant-1', organizationId: 'org-1', isPublic: false, anonymous: false, expected: 'private, max-age=60' },
    { name: 'global public anonymous', tenantId: null, organizationId: null, isPublic: true, anonymous: true, expected: 'public, max-age=3600' },
    { name: 'global public authenticated', tenantId: null, organizationId: null, isPublic: true, anonymous: false, expected: 'public, max-age=3600' },
    { name: 'global private', tenantId: null, organizationId: null, isPublic: false, anonymous: false, expected: 'private, max-age=60' },
    { name: 'tenant-only public', tenantId: 'tenant-1', organizationId: null, isPublic: true, anonymous: false, expected: 'private, max-age=60' },
    { name: 'organization-only public', tenantId: null, organizationId: 'org-1', isPublic: true, anonymous: false, expected: 'private, max-age=60' },
  ])('sets safe caching for $name bytes', async ({ tenantId, organizationId, isPublic, anonymous, expected }) => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server') as { getAuthFromRequest: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce(anonymous ? null : { isSuperAdmin: true })
    mockEm.findOne
      .mockResolvedValueOnce({ ...mockAttachment, tenantId, organizationId })
      .mockResolvedValueOnce({ ...mockPartition, isPublic })
    prepareValidImageRendering()

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(expected)
    expect(await response.text()).toBe('rendered-image')
  })

  it('keeps same-scope public bytes private', async () => {
    mockEm.findOne
      .mockResolvedValueOnce(mockAttachment)
      .mockResolvedValueOnce({ ...mockPartition, isPublic: true })
    prepareValidImageRendering()

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60')
  })

  it.each([
    { name: 'anonymous scoped public', auth: null, tenantId: 'tenant-1', organizationId: 'org-1', isPublic: true, status: 401 },
    { name: 'anonymous global private', auth: null, tenantId: null, organizationId: null, isPublic: false, status: 401 },
    { name: 'wrong organization public', auth: { tenantId: 'tenant-1', orgId: 'other-org' }, tenantId: 'tenant-1', organizationId: 'org-1', isPublic: true, status: 403 },
    { name: 'wrong tenant public', auth: { tenantId: 'other-tenant', orgId: 'org-1' }, tenantId: 'tenant-1', organizationId: 'org-1', isPublic: true, status: 403 },
    { name: 'partial scope public', auth: { tenantId: 'tenant-1', orgId: 'org-1' }, tenantId: 'tenant-1', organizationId: null, isPublic: true, status: 403 },
  ])('denies $name before reading bytes', async ({ auth, tenantId, organizationId, isPublic, status }) => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server') as { getAuthFromRequest: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce(auth)
    mockEm.findOne
      .mockResolvedValueOnce({ ...mockAttachment, tenantId, organizationId })
      .mockResolvedValueOnce({ ...mockPartition, isPublic })

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control') ?? '').not.toContain('public')
    expect(mockResolveForPartition).not.toHaveBeenCalled()
    expect(mockStorageRead).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'scoped public', tenantId: 'tenant-1', organizationId: 'org-1', expected: 'private, max-age=60' },
    { name: 'global public', tenantId: null, organizationId: null, expected: 'public, max-age=3600' },
  ])('uses the same policy for $name thumbnail cache hits', async ({ tenantId, organizationId, expected }) => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server') as { getAuthFromRequest: jest.Mock }
    const { readThumbnailCache } = await import('@open-mercato/core/modules/attachments/lib/thumbnailCache') as { readThumbnailCache: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce({ isSuperAdmin: true })
    mockEm.findOne
      .mockResolvedValueOnce({ ...mockAttachment, tenantId, organizationId })
      .mockResolvedValueOnce({ ...mockPartition, isPublic: true })
    readThumbnailCache.mockResolvedValueOnce(Buffer.from('cached-image'))

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1?width=100') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(expected)
    expect(await response.text()).toBe('cached-image')
    expect(mockStorageRead).not.toHaveBeenCalled()
    expect(mockSharp).not.toHaveBeenCalled()
  })

  it('rejects anonymous scoped requests before reading the thumbnail cache', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server') as { getAuthFromRequest: jest.Mock }
    const { readThumbnailCache } = await import('@open-mercato/core/modules/attachments/lib/thumbnailCache') as { readThumbnailCache: jest.Mock }
    getAuthFromRequest.mockResolvedValueOnce(null)
    mockEm.findOne
      .mockResolvedValueOnce(mockAttachment)
      .mockResolvedValueOnce({ ...mockPartition, isPublic: true })

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-1?width=100') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(401)
    expect(readThumbnailCache).not.toHaveBeenCalled()
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
