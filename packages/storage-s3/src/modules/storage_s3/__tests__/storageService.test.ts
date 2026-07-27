/** @jest-environment node */

const mockSend = jest.fn()

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'PutObject', ...params })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'GetObject', ...params })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ _type: 'DeleteObject', ...params })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ _type: 'ListObjectsV2', ...params })),
}))

const mockGetSignedUrl = jest.fn().mockResolvedValue('https://presigned.example.com/object?sig=abc')
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

import { createStorageService } from '../lib/storage-service'

const BASE_CONFIG = { bucket: 'test-bucket', region: 'eu-central-1' }
const TENANT_SCOPE = { organizationId: 'org-owned', tenantId: 'tenant-owned' }

beforeEach(() => {
  mockSend.mockReset()
  mockGetSignedUrl.mockReset()
  mockGetSignedUrl.mockResolvedValue('https://presigned.example.com/object?sig=abc')
})

describe('createStorageService', () => {
  it('rejects cross-tenant downloads before calling S3', async () => {
    const service = createStorageService(BASE_CONFIG)

    await expect(
      service.download({
        key: 'docs/org_org-victim/tenant_tenant-owned/file.txt',
        scope: TENANT_SCOPE,
      }),
    ).rejects.toThrow('S3 key is not scoped to the active tenant')

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('allows shared namespace downloads for the requested scope', async () => {
    mockSend.mockResolvedValueOnce({
      Body: {
        on(event: string, callback: (chunk?: Buffer) => void) {
          if (event === 'data') callback(Buffer.from('shared'))
          if (event === 'end') callback()
          return this
        },
      },
      ContentType: 'text/plain',
    })
    const service = createStorageService(BASE_CONFIG)

    const result = await service.download({
      key: 'docs/org_shared/tenant_shared/shared.txt',
      scope: TENANT_SCOPE,
    })

    expect(result.buffer.toString()).toBe('shared')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-tenant deletes before calling S3', async () => {
    const service = createStorageService(BASE_CONFIG)

    await expect(
      service.delete({
        key: 'docs/org_org-victim/tenant_tenant-owned/file.txt',
        scope: TENANT_SCOPE,
      }),
    ).rejects.toThrow('S3 key is not scoped to the active tenant')

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects cross-tenant local-path downloads before calling S3', async () => {
    const service = createStorageService(BASE_CONFIG)

    await expect(
      service.toLocalPath({
        key: 'docs/org_org-owned/tenant_tenant-victim/file.txt',
        scope: TENANT_SCOPE,
      }),
    ).rejects.toThrow('S3 key is not scoped to the active tenant')

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects cross-tenant signed URLs before presigning', async () => {
    const service = createStorageService(BASE_CONFIG)

    await expect(
      service.getSignedUrl({
        key: 'docs/org_org-owned/tenant_tenant-victim/file.txt',
        operation: 'download',
        scope: TENANT_SCOPE,
      }),
    ).rejects.toThrow('S3 key is not scoped to the active tenant')

    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })

  it('keeps shared namespace unavailable for upload signed URLs', async () => {
    const service = createStorageService(BASE_CONFIG)

    await expect(
      service.getSignedUrl({
        key: 'docs/org_shared/tenant_shared/shared.txt',
        operation: 'upload',
        scope: TENANT_SCOPE,
      }),
    ).rejects.toThrow('S3 key is not scoped to the active tenant')

    expect(mockGetSignedUrl).not.toHaveBeenCalled()
  })

  it('filters list results to the requested tenant scope', async () => {
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Key: 'docs/org_org-owned/tenant_tenant-owned/a.txt', Size: 100, LastModified: new Date('2026-01-01') },
        { Key: 'docs/org_org-victim/tenant_tenant-owned/b.txt', Size: 200, LastModified: new Date('2026-01-02') },
      ],
      IsTruncated: false,
    })
    const service = createStorageService(BASE_CONFIG)

    const result = await service.list({ prefix: '', scope: TENANT_SCOPE })

    expect(result.files.map((file) => file.key)).toEqual([
      'docs/org_org-owned/tenant_tenant-owned/a.txt',
    ])
  })
})
