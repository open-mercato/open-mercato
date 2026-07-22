const getAuthFromRequestMock = jest.fn()
const credentialsResolveMock = jest.fn()

const putObjectMock = jest.fn()
const getBucketMock = jest.fn(() => 'test-bucket')
const listObjectsMock = jest.fn()
const readMock = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'integrationCredentialsService') {
        return { resolve: credentialsResolveMock }
      }
      return null
    },
  }),
}))

jest.mock('../../../../packages/storage-s3/src/modules/storage_s3/lib/s3-driver', () => ({
  S3StorageDriver: jest.fn().mockImplementation(() => ({
    putObject: putObjectMock,
    getBucket: getBucketMock,
    listObjects: listObjectsMock,
    read: readMock,
  })),
}))

import { S3StorageDriver } from '../../../../packages/storage-s3/src/modules/storage_s3/lib/s3-driver'
import { GET as download } from '../../../../packages/storage-s3/src/modules/storage_s3/api/get/storage-providers/s3/download'
import { POST as upload } from '../../../../packages/storage-s3/src/modules/storage_s3/api/post/storage-providers/s3/upload'

describe('storage_s3 upload/download routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ tenantId: 'tenant-1', orgId: 'org-1' })
    credentialsResolveMock.mockResolvedValue({ bucket: 'bucket' })
    listObjectsMock.mockResolvedValue({ files: [], truncated: false, nextContinuationToken: undefined })
    putObjectMock.mockResolvedValue(undefined)
    readMock.mockResolvedValue({ buffer: Buffer.from('body'), contentType: 'image/png' })
  })

  it('rejects active content uploads even when client contentType looks safe', async () => {
    const form = new FormData()
    form.append('file', new File(['<html><body>x</body></html>'], 'payload.html', { type: 'text/plain' }))
    form.append('contentType', 'image/png')

    const response = await upload(new Request('http://test/api/storage-providers/s3/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Active content uploads are not allowed.' })
    expect(putObjectMock).not.toHaveBeenCalled()
  })

  it('uses trusted detected MIME instead of attacker-supplied contentType', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const form = new FormData()
    form.append('file', new File([pngBuffer], 'proof.png', { type: 'text/plain' }))
    form.append('contentType', 'text/html')

    const response = await upload(new Request('http://test/api/storage-providers/s3/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(200)
    expect(S3StorageDriver).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'bucket',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    }))
    expect(putObjectMock).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), 'image/png')
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      bucket: 'test-bucket',
      contentType: 'image/png',
      size: pngBuffer.length,
    }))
  })

  it('rejects uploads that exceed tenant quota', async () => {
    listObjectsMock.mockResolvedValueOnce({
      files: [{ key: 'uploads/org_org-1/tenant_tenant-1/existing.bin', size: 536_870_912, lastModified: new Date() }],
      truncated: false,
      nextContinuationToken: undefined,
    })
    const form = new FormData()
    form.append('file', new File(['a'], 'tiny.txt', { type: 'text/plain' }))

    const response = await upload(new Request('http://test/api/storage-providers/s3/upload', {
      method: 'POST',
      body: form,
    }))

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Attachment storage quota exceeded for this tenant.' })
    expect(putObjectMock).not.toHaveBeenCalled()
  })

  it('forces attachment download headers for unsafe inline content', async () => {
    readMock.mockResolvedValueOnce({ buffer: Buffer.from('<svg/>'), contentType: 'image/svg+xml' })

    const response = await download(new Request('http://test/api/storage-providers/s3/download?key=uploads/org_org-1/tenant_tenant-1/file.svg'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-disposition')).toContain('attachment;')
  })

  it('allows inline rendering only for safe image MIME types', async () => {
    readMock.mockResolvedValueOnce({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' })

    const response = await download(new Request('http://test/api/storage-providers/s3/download?key=uploads/org_org-1/tenant_tenant-1/file.png'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-disposition')).toContain('inline;')
  })
})
