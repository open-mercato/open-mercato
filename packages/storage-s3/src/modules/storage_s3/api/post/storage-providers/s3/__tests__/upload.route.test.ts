/** @jest-environment node */

const mockPutObject = jest.fn().mockResolvedValue(undefined)
const mockGetBucket = jest.fn().mockReturnValue('test-bucket')
const mockReadTenantAttachmentUsageBytes = jest.fn(async () => 0)

jest.mock('../../../../../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    getBucket: mockGetBucket,
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (_key: string, fallback: string) => fallback,
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/tenant-usage', () => ({
  readTenantAttachmentUsageBytes: () => mockReadTenantAttachmentUsageBytes(),
}))

const mockEm = {}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'integrationCredentialsService') {
        return {
          resolve: jest.fn(async () => ({
            bucket: 'test-bucket',
            accessKeyId: 'AKID',
            secretAccessKey: 'SECRET',
          })),
        }
      }
      return null
    },
  })),
}))

type UploadRoute = typeof import('../upload')

function buildMultipartRequest(file: File, extra: Record<string, string> = {}) {
  const form = new FormData()
  form.set('file', file)
  for (const [key, value] of Object.entries(extra)) {
    form.set(key, value)
  }
  return new Request('http://localhost/api/storage-providers/s3/upload', {
    method: 'POST',
    body: form,
  })
}

function scopedKey(fileName: string) {
  return `uploads/org_org-1/tenant_tenant-1/${fileName}`
}

describe('S3 upload route', () => {
  let POST: UploadRoute['POST']

  beforeAll(async () => {
    POST = (await import('../upload')).POST
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockReadTenantAttachmentUsageBytes.mockResolvedValue(0)
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '25'
    process.env.OM_ATTACHMENT_TENANT_QUOTA_MB = '512'
  })

  afterEach(() => {
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OM_ATTACHMENT_TENANT_QUOTA_MB
  })

  it('uploads a safe file with trusted MIME type', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const file = new File([pngHeader], 'photo.png', { type: 'text/html' })
    const response = await POST(buildMultipartRequest(file))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.key).toContain('org_org-1/tenant_tenant-1/')
    expect(body.contentType).toBe('image/png')
    expect(mockPutObject).toHaveBeenCalledWith(
      expect.stringContaining('photo.png'),
      expect.any(Buffer),
      'image/png',
    )
  })

  it('rejects active content uploads', async () => {
    const file = new File(['<html><script>alert(1)</script></html>'], 'page.html', { type: 'text/plain' })
    const response = await POST(buildMultipartRequest(file, { key: scopedKey('page.html') }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Active content uploads are not allowed.' })
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('rejects dangerous executable extensions', async () => {
    const file = new File(['echo bad'], 'script.ps1', { type: 'application/octet-stream' })
    const response = await POST(buildMultipartRequest(file, { key: scopedKey('script.ps1') }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Executable file types are not allowed as attachments.' })
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('rejects files above the global upload limit', async () => {
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '1'
    const file = new File([Buffer.alloc(2 * 1024 * 1024)], 'large.bin', { type: 'application/octet-stream' })
    const response = await POST(buildMultipartRequest(file, { key: scopedKey('large.bin') }))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Attachment exceeds the maximum upload size.' })
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('rejects uploads that exceed the tenant attachment quota', async () => {
    process.env.OM_ATTACHMENT_TENANT_QUOTA_MB = '1'
    mockReadTenantAttachmentUsageBytes.mockResolvedValueOnce(1_048_576)
    const file = new File(['small payload'], 'note.txt', { type: 'text/plain' })
    const response = await POST(buildMultipartRequest(file, { key: scopedKey('note.txt') }))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Attachment storage quota exceeded for this tenant.' })
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('rejects key overrides outside tenant scope', async () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const response = await POST(buildMultipartRequest(file, { key: 'exports/other-tenant/note.txt' }))

    expect(response.status).toBe(403)
    expect(mockPutObject).not.toHaveBeenCalled()
  })
})

export {}
