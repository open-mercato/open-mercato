/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string) => `translated:${key}`,
  }),
}))

const mockResolveCredentials = jest.fn()
const mockReserve = jest.fn()
const mockReconcileStandaloneObjects = jest.fn()
const mockRelease = jest.fn()
let quotaServiceRegistered = false
const mockCreateRequestContainer = jest.fn(async () => ({
  resolve: (key: string) => {
    if (key === 'integrationCredentialsService') return { resolve: mockResolveCredentials }
    if (quotaServiceRegistered && key === 'attachmentQuotaService') {
      return {
        reserve: (...args: unknown[]) => mockReserve(...args),
        reconcileStandaloneObjects: (...args: unknown[]) => mockReconcileStandaloneObjects(...args),
        release: (...args: unknown[]) => mockRelease(...args),
      }
    }
    if (quotaServiceRegistered && key === 'storageS3QuotaRecoveryScheduler') return jest.fn()
    throw new Error(`Unexpected dependency: ${key}`)
  },
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
    mockReconcileStandaloneObjects.mockResolvedValue(undefined)
    quotaServiceRegistered = false
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
    await expect(response.json()).resolves.toEqual({
      error: 'translated:storage_s3.errors.maxUploadSize',
    })
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

  // Regression guards for the quota-admission responses #4076 shipped unlocalized
  // (#4926, #4995, #5000). The suite mocks `resolveTranslations`, so a localized
  // body reads `translated:<key>` while a hardcoded English string does not.
  describe('quota-admission error responses', () => {
    function uploadRequest(): Request {
      const form = new FormData()
      form.set('file', new File([new TextEncoder().encode('safe')], 'safe.txt', { type: 'text/plain' }))
      return new Request('http://example.test/api/storage-providers/s3/upload', { method: 'POST', body: form })
    }

    it('localizes the persist failure response', async () => {
      mockPutObject.mockRejectedValueOnce(new Error('s3 unreachable'))

      const response = await POST(uploadRequest())

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.persistFailed',
      })
    })

    it('localizes the exceeded tenant quota response', async () => {
      quotaServiceRegistered = true
      mockReserve.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'quota_exceeded' }))

      const response = await POST(uploadRequest())

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.quotaExceeded',
      })
      expect(mockPutObject).not.toHaveBeenCalled()
    })

    it('localizes the existing target key response', async () => {
      quotaServiceRegistered = true
      mockReserve.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'quota_target_exists' }))

      const response = await POST(uploadRequest())

      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.quotaTargetExists',
      })
    })

    it('localizes the reservation failure response', async () => {
      quotaServiceRegistered = true
      mockReserve.mockRejectedValueOnce(new Error('reservation backend down'))

      const response = await POST(uploadRequest())

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.quotaUnavailable',
      })
    })
  })
})
