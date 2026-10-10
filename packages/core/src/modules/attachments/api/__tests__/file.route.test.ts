/** @jest-environment node */

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

const mockStorageRead = jest.fn(async () => ({ buffer: Buffer.from('data') }))
const mockResolveForPartition = jest.fn(async () => ({ read: mockStorageRead }))

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
      return mockResolveForPartition()
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
    mockResolveAttachmentRequestScope.mockImplementation(
      async (_container: unknown, auth: AuthStub | null | undefined) => ({
        denied: false,
        organizationId: auth?.orgId ?? null,
      }),
    )
  })

  it('serves a same-scope private attachment', async () => {
    const response = await GET(
      new Request('http://localhost/api/attachments/file/att-1') as Parameters<FileRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne.mock.calls[0][1]).toEqual({
      id: 'att-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockStorageRead).toHaveBeenCalledWith('privateAttachments', 'stored/file.txt')
  })

  it('scopes the lookup to the currently selected organization, not the uploader home org (#3765)', async () => {
    // A multi-org admin viewing an attachment stored under the selected org:
    // auth.orgId stays 'org-1' (home) but the request scope resolves the selected org.
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: false, organizationId: 'selected-org' })
    mockEm.findOne.mockImplementationOnce(async () => ({
      ...mockAttachment,
      organizationId: 'selected-org',
    }))

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
  })

  it('answers a denied organization scope with not-found and never queries the attachment', async () => {
    // A principal whose org scope resolves to the empty set can reach no
    // attachment. The deny must surface as the route's own 404 — widening back to
    // a tenant-only filter would reopen the cross-org read, and letting the scope
    // resolver throw would surface as a 500 (this route has no CrudHttpError
    // handler of its own).
    mockResolveAttachmentRequestScope.mockResolvedValueOnce({ denied: true, organizationId: null })

    const response = await GET(
      new Request('http://localhost/api/attachments/file/att-1') as Parameters<FileRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(mockEm.findOne).not.toHaveBeenCalled()
    expect(mockStorageRead).not.toHaveBeenCalled()
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

    const response = await GET(
      new Request('http://localhost/api/attachments/file/att-1') as Parameters<FileRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-1' }) },
    )

    expect(response.status).toBe(200)
    expect(mockEm.findOne.mock.calls[0][1]).toEqual({ id: 'att-1' })
    expect(mockStorageRead).toHaveBeenCalledWith('privateAttachments', 'stored/file.txt')
  })

  describe('sanitised vector images', () => {
    const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto')
    const storedBytes = Buffer.from('data')
    const vectorRecord = {
      sanitizer: 'dompurify',
      sanitizerVersion: '3.4.11',
      policyVersion: 1,
      sha256: createHash('sha256').update(storedBytes).digest('hex'),
      sanitizedAt: '2026-10-05T10:00:00.000Z',
    }

    function serveAttachment(overrides: Record<string, unknown>) {
      const record = { ...mockAttachment, fileName: 'logo.svg', mimeType: 'image/svg+xml', ...overrides }
      mockEm.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
        if (where.id === 'att-1') return record
        if (where.code === 'privateAttachments') return mockPartition
        return null
      })
    }

    async function request(url = 'http://localhost/api/attachments/file/att-1') {
      return GET(new Request(url) as Parameters<FileRoute['GET']>[0], { params: Promise.resolve({ id: 'att-1' }) })
    }

    afterEach(() => {
      mockEm.findOne.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => {
        if (where.id === 'att-1') return mockAttachment
        if (where.code === 'privateAttachments') return mockPartition
        return null
      })
    })

    it('sets the strict CSP on its own JSON error responses', async () => {
      mockEm.findOne.mockImplementation(async () => null)

      const response = await request()

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it('serves a recorded vector image inline as image/svg+xml under a sandboxing CSP', async () => {
      const security = jest.mocked(await import('@open-mercato/core/modules/attachments/lib/security'))
      security.canRenderInlineAttachment.mockReturnValue(false)
      serveAttachment({ storageMetadata: { vectorImage: vectorRecord } })

      const response = await request()

      expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      )
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(security.buildAttachmentContentDisposition).toHaveBeenCalledWith('logo.svg', 'inline')
      security.canRenderInlineAttachment.mockReturnValue(true)
    })

    it.each([
      ['an encoded path segment', 'http://localhost/api/attachments/%66ile/att-1'],
      ['encoded slashes', 'http://localhost/api/attachments%2Ffile%2Fatt-1'],
      ['an encoded module segment', 'http://localhost/api/%61ttachments/file/att-1'],
      ['an encoded id', 'http://localhost/api/attachments/file/%61tt-1'],
    ])('downloads a recorded vector image requested through %s, which the sandboxing header rule does not match', async (_label, url) => {
      const security = jest.mocked(await import('@open-mercato/core/modules/attachments/lib/security'))
      security.canRenderInlineAttachment.mockReturnValue(false)
      serveAttachment({ storageMetadata: { vectorImage: vectorRecord } })

      const response = await request(url)

      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
      expect(security.buildAttachmentContentDisposition).toHaveBeenCalledWith('logo.svg', 'attachment')
      expect(security.buildAttachmentContentDisposition).not.toHaveBeenCalledWith('logo.svg', 'inline')
      security.canRenderInlineAttachment.mockReturnValue(true)
    })

    it('forces a download of a recorded vector image on ?download=1', async () => {
      const security = jest.mocked(await import('@open-mercato/core/modules/attachments/lib/security'))
      serveAttachment({ storageMetadata: { vectorImage: vectorRecord } })

      const response = await request('http://localhost/api/attachments/file/att-1?download=1')

      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(security.buildAttachmentContentDisposition).toHaveBeenCalledWith('logo.svg', 'attachment')
    })

    it.each([
      ['without a vector record', { storageMetadata: { tags: [] } }],
      ['whose stored bytes do not match the record', { storageMetadata: { vectorImage: { ...vectorRecord, sha256: '0'.repeat(64) } } }],
    ])('keeps an SVG row %s download-only', async (_label, overrides) => {
      const security = jest.mocked(await import('@open-mercato/core/modules/attachments/lib/security'))
      security.canRenderInlineAttachment.mockReturnValue(false)
      serveAttachment(overrides)

      const response = await request()

      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(security.buildAttachmentContentDisposition).toHaveBeenCalledWith('logo.svg', 'attachment')
      security.canRenderInlineAttachment.mockReturnValue(true)
    })
  })
})
