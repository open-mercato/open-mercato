/** @jest-environment node */

const mockRead = jest.fn()

jest.mock('../../../../../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    read: mockRead,
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
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

type DownloadRoute = typeof import('../download')

const scopedKey = 'uploads/org_org-1/tenant_tenant-1/20260101_photo.png'

describe('S3 download route', () => {
  let GET: DownloadRoute['GET']

  beforeAll(async () => {
    GET = (await import('../download')).GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('serves safe images inline with protective headers', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    mockRead.mockResolvedValueOnce({ buffer: pngHeader, contentType: 'text/html' })

    const response = await GET(
      new Request(`http://localhost/api/storage-providers/s3/download?key=${encodeURIComponent(scopedKey)}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Content-Disposition')).toContain('inline')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
  })

  it('forces attachment disposition for active content', async () => {
    mockRead.mockResolvedValueOnce({
      buffer: Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
      contentType: 'text/html',
    })
    const htmlKey = 'uploads/org_org-1/tenant_tenant-1/page.html'

    const response = await GET(
      new Request(`http://localhost/api/storage-providers/s3/download?key=${encodeURIComponent(htmlKey)}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
  })

  it('forces attachment when download=1 is set even for safe images', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    mockRead.mockResolvedValueOnce({ buffer: pngHeader, contentType: 'image/png' })

    const response = await GET(
      new Request(`http://localhost/api/storage-providers/s3/download?key=${encodeURIComponent(scopedKey)}&download=1`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
  })

  it('rejects keys outside tenant scope', async () => {
    const response = await GET(
      new Request('http://localhost/api/storage-providers/s3/download?key=exports/other-tenant/file.txt'),
    )

    expect(response.status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })
})

export {}
