/** @jest-environment node */

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockResolveCredentials = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => {
      if (name === 'integrationCredentialsService') {
        return { resolve: mockResolveCredentials }
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })),
}))

const mockRead = jest.fn()
const mockDelete = jest.fn()
const mockGetSignedUrl = jest.fn()
jest.mock('../lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    read: (...args: unknown[]) => mockRead(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
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
    expect(mockGetSignedUrl).not.toHaveBeenCalled()
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
    }
    expect(mockRead).not.toHaveBeenCalled()
  })
})
