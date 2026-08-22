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
let quotaServiceRegistered = false
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'integrationCredentialsService') {
        return { resolve: mockResolveCredentials }
      }
      if (quotaServiceRegistered && name === 'attachmentQuotaService') {
        return {
          reserve: (...args: unknown[]) => mockReserve(...args),
          reconcileStandaloneObjects: (...args: unknown[]) => mockReconcileStandaloneObjects(...args),
          release: jest.fn(),
        }
      }
      if (quotaServiceRegistered && name === 'storageS3QuotaRecoveryScheduler') {
        return jest.fn()
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })),
}))

const mockRead = jest.fn()
const mockDelete = jest.fn()
const mockGetSignedUrl = jest.fn()
const mockListObjects = jest.fn()
jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    read: (...args: unknown[]) => mockRead(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    listObjects: (...args: unknown[]) => mockListObjects(...args),
  })),
}))

import { DELETE } from '../api/delete/storage-providers/s3/delete'
import { GET } from '../api/get/storage-providers/s3/download'
import { POST } from '../api/post/storage-providers/s3/signed-url'

const AUTH = { tenantId: 'tenant-1', orgId: 'org-1' }
const SHARED_KEY = 'docs/org_shared/tenant_shared/shared.txt'
const FOREIGN_KEY = 'docs/org_other/tenant_tenant-1/private.txt'
const NESTED_FOREIGN_KEY = 'docs/org_other/tenant_tenant-1/org_org-1/tenant_tenant-1/private.txt'

function jsonRequest(body: unknown): Request {
  return new Request('http://example.test/api/storage-providers/s3', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('storage_s3 standalone route key scope', () => {
  beforeEach(() => {
    mockGetAuthFromRequest.mockResolvedValue(AUTH)
    mockResolveCredentials.mockResolvedValue({ bucket: 'test-bucket', region: 'eu-central-1' })
    mockRead.mockReset()
    mockDelete.mockReset()
    mockGetSignedUrl.mockReset()
    mockReserve.mockReset()
    mockReconcileStandaloneObjects.mockReset()
    mockReconcileStandaloneObjects.mockResolvedValue(undefined)
    mockListObjects.mockResolvedValue({ files: [], truncated: false })
    quotaServiceRegistered = false
  })

  it('downloads shared namespace objects for an authorized storage manager', async () => {
    mockRead.mockResolvedValueOnce({
      buffer: Buffer.from('shared-bytes'),
      contentType: 'text/plain',
    })

    const response = await GET(
      new Request(`http://example.test/api/storage-providers/s3/download?key=${encodeURIComponent(SHARED_KEY)}`),
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('shared-bytes')
    expect(mockRead).toHaveBeenCalledWith('', SHARED_KEY)
  })

  it('generates signed URLs for shared namespace objects', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.test/shared?sig=abc')

    const response = await POST(jsonRequest({
      key: SHARED_KEY,
      operation: 'download',
      expiresIn: 600,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      url: 'https://s3.example.test/shared?sig=abc',
    })
    expect(mockGetSignedUrl).toHaveBeenCalledWith(SHARED_KEY, 'download', 600, undefined)
  })

  it('keeps shared namespace keys unavailable for signed upload URLs', async () => {
    const response = await POST(jsonRequest({
      key: SHARED_KEY,
      operation: 'upload',
      expiresIn: 600,
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:storage_s3.errors.keyAccessDenied',
    })
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })

  // Regression guards for the quota-admission responses #4076 shipped unlocalized
  // (#4926, #4995, #5000 — the same shape three times). This suite mocks
  // `resolveTranslations`, so a localized body reads `translated:<key>` while a
  // hardcoded English string does not, which is what lets the guard live next to
  // the route instead of only in the app-level consumer suite one layer up.
  describe('signed upload URL quota-admission responses', () => {
    const OWN_KEY = 'docs/org_org-1/tenant_tenant-1/mine.txt'

    function uploadRequest(): Request {
      return jsonRequest({ key: OWN_KEY, operation: 'upload', expiresIn: 600 })
    }

    it('localizes the missing quota service response', async () => {
      const response = await POST(uploadRequest())

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.quotaUnavailable',
      })
      expect(mockReserve).not.toHaveBeenCalled()
    })

    it('localizes the exceeded tenant quota response', async () => {
      quotaServiceRegistered = true
      mockReserve.mockRejectedValueOnce(Object.assign(new Error('quota'), { code: 'quota_exceeded' }))

      const response = await POST(uploadRequest())

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.quotaExceeded',
      })
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

  it('localizes invalid delete payload errors', async () => {
    const response = await DELETE(new Request('http://example.test/api/storage-providers/s3/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'translated:storage_s3.errors.invalidPayload',
    })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('deletes shared namespace objects for an authorized storage manager', async () => {
    mockDelete.mockResolvedValueOnce(undefined)

    const response = await DELETE(new Request('http://example.test/api/storage-providers/s3/delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: SHARED_KEY }),
    }))

    expect(response.status).toBe(204)
    expect(mockDelete).toHaveBeenCalledWith('', SHARED_KEY)
  })

  it('keeps rejecting keys scoped to another organization or tenant', async () => {
    for (const key of [FOREIGN_KEY, NESTED_FOREIGN_KEY]) {
      const response = await GET(
        new Request(`http://example.test/api/storage-providers/s3/download?key=${encodeURIComponent(key)}`),
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: 'translated:storage_s3.errors.keyAccessDenied',
      })
    }
    expect(mockRead).not.toHaveBeenCalled()
  })
})
