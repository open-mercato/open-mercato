/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockResolveCredentials = jest.fn()
const mockCreateRequestContainer = jest.fn(async () => ({
  resolve: () => ({ resolve: mockResolveCredentials }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))

const mockListObjects = jest.fn()
const mockPutObject = jest.fn()
jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    getBucket: () => 'test-bucket',
    listObjects: (...args: unknown[]) => mockListObjects(...args),
    putObject: (...args: unknown[]) => mockPutObject(...args),
  })),
}))

import { POST } from '../api/post/storage-providers/s3/upload'

describe('storage_s3 direct upload route', () => {
  const originalMaxUploadMb = process.env.OM_ATTACHMENT_MAX_UPLOAD_MB

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-1' })
    mockResolveCredentials.mockResolvedValue({ bucket: 'test-bucket', region: 'eu-central-1' })
    mockListObjects.mockResolvedValue({ files: [], truncated: false })
    mockPutObject.mockResolvedValue(undefined)
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
  })

  afterAll(() => {
    if (originalMaxUploadMb === undefined) delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    else process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = originalMaxUploadMb
  })

  it('rejects oversized streamed metadata without trusting content length', async () => {
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '0.000001'
    const boundary = 'oversized-key'
    const body = new TextEncoder().encode([
      `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n`,
      'x'.repeat(1024 * 1024),
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="small.txt"\r\n`,
      'Content-Type: text/plain\r\n\r\ns\r\n',
      `--${boundary}--\r\n`,
    ].join(''))
    const request = new Request('http://example.test/api/storage-providers/s3/upload', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    })

    expect(request.headers.get('content-length')).toBeNull()
    const response = await POST(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Attachment exceeds the maximum upload size.' })
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(mockPutObject).not.toHaveBeenCalled()
  })

  it('preserves valid multipart parsing for a normal upload', async () => {
    const form = new FormData()
    form.set('file', new File([new TextEncoder().encode('safe')], 'safe.txt', { type: 'text/plain' }))
    const response = await POST(new Request('http://example.test/api/storage-providers/s3/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ bucket: 'test-bucket', size: 4 })
    expect(mockPutObject).toHaveBeenCalledTimes(1)
  })
})
