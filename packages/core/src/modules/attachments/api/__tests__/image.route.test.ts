/** @jest-environment node */

import { promises as fs } from 'fs'

const mockSharp = jest.fn()
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ tenantId: 'tenant-1', orgId: 'org-1', roles: ['admin'] })),
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

jest.mock('@open-mercato/core/modules/attachments/lib/access', () => ({
  checkAttachmentAccess: jest.fn(() => ({ ok: true })),
}))

const mockAttachment = {
  id: 'att-1',
  mimeType: 'image/png',
  partitionCode: 'privateAttachments',
  storagePath: 'stored/image',
  storageDriver: 'local',
}

const mockPartition = {
  code: 'privateAttachments',
  isPublic: false,
}

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

describe('attachments image route', () => {
  let GET: ImageRoute['GET']

  beforeAll(async () => {
    GET = (await import('../image/[id]/[[...slug]]/route')).GET
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects spoofed image content before invoking sharp', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValueOnce(Buffer.from('RIFF0000WEBP', 'ascii'))

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
