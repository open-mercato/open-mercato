/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { GET as getFile } from '../file/[id]/route'
import { GET as getImage } from '../image/[id]/[[...slug]]/route'
import { registerAttachmentAccessResolvers } from '../../lib/access-registry'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentRequestScope: jest.fn(async (_container: unknown, auth: { orgId?: string } | null) => ({
    denied: false, organizationId: auth?.orgId ?? null,
  })),
}))
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {}, AttachmentPartition: class AttachmentPartition {},
}))
jest.mock('@open-mercato/core/modules/attachments/lib/drivers', () => ({ StorageDriverFactory: class {} }))

const mockRead = jest.fn(async () => ({ buffer: Buffer.from('original image bytes') }))
const mockResolveDriver = jest.fn(async () => ({ read: mockRead }))
const mockReadThumbnail = jest.fn(async () => Buffer.from('cached image bytes'))
jest.mock('@open-mercato/core/modules/attachments/lib/thumbnailCache', () => ({
  buildThumbnailCacheKey: () => 'thumbnail',
  readThumbnailCache: (...args: unknown[]) => mockReadThumbnail(...args),
  writeThumbnailCache: jest.fn(),
}))

const mockAuth = { sub: 'reader', tenantId: 'tenant', orgId: 'org', roles: [] }
const mockAttachment = {
  id: 'synthetic-file', entityId: 'attachments:library', recordId: 'synthetic-owner',
  partitionCode: 'private', storagePath: 'synthetic.png', fileName: 'synthetic.png',
  mimeType: 'image/png', fileSize: 20, tenantId: 'tenant' as string | null, organizationId: 'org' as string | null,
}
const mockPartition = { code: 'private', isPublic: false }
const mockRbac = {
  loadAcl: jest.fn(async () => ({ isSuperAdmin: false, organizations: ['org'] })),
  getEffectiveFeatures: jest.fn(async () => ['attachments.view']),
}
const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    if (where.code === mockPartition.code) return mockPartition
    if (where.id !== mockAttachment.id) return null
    if (where.tenantId && where.tenantId !== mockAttachment.tenantId) return null
    if (where.organizationId && where.organizationId !== mockAttachment.organizationId) return null
    return mockAttachment
  }),
}
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => key === 'em' ? mockEm : key === 'storageDriverFactory'
      ? { resolveForPartition: mockResolveDriver } : key === 'rbacService' ? mockRbac : null,
  })),
}))

const paths = ['file', 'download', 'image'] as const
function readBytes(path: typeof paths[number]) {
  const url = path === 'image' ? 'image/synthetic-file?width=20' : `file/synthetic-file${path === 'download' ? '?download=1' : ''}`
  const handler = path === 'image' ? getImage : getFile
  return handler(new Request(`http://localhost/api/attachments/${url}`) as Parameters<typeof handler>[0], {
    params: Promise.resolve({ id: mockAttachment.id }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue(mockAuth)
  mockAttachment.tenantId = 'tenant'
  mockAttachment.organizationId = 'org'
  mockPartition.isPublic = false
  mockRbac.loadAcl.mockResolvedValue({ isSuperAdmin: false, organizations: ['org'] })
  mockRbac.getEffectiveFeatures.mockResolvedValue(['attachments.view'])
  registerAttachmentAccessResolvers([])
})
afterEach(() => registerAttachmentAccessResolvers([]))

describe.each(paths)('private attachment %s bytes (#8760)', (path) => {
  it.each([{ features: [] }, { features: ['attachments.manage'] }])('denies insufficient live grants $features before bytes or cache lookup', async ({ features }) => {
    mockRbac.getEffectiveFeatures.mockResolvedValue(features)
    jest.mocked(getAuthFromRequest).mockResolvedValue({ ...mockAuth, features: ['*'] })
    const response = await readBytes(path)
    expect(response.status).toBe(403)
    expect(mockResolveDriver).not.toHaveBeenCalled()
    expect(mockRead).not.toHaveBeenCalled()
    expect(mockReadThumbnail).not.toHaveBeenCalled()
  })

  it.each(['attachments.view', 'attachments.*', '*'])('allows a live %s grant', async (grant) => {
    mockRbac.getEffectiveFeatures.mockResolvedValue([grant])
    const response = await readBytes(path)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(path === 'image' ? 'cached image bytes' : 'original image bytes')
  })

  it('retains cross-tenant lookup denial even with a wildcard grant', async () => {
    jest.mocked(getAuthFromRequest).mockResolvedValue({ ...mockAuth, tenantId: 'foreign' })
    mockRbac.getEffectiveFeatures.mockResolvedValue(['*'])
    expect((await readBytes(path)).status).toBe(404)
    expect(mockReadThumbnail).not.toHaveBeenCalled()
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('retains owner denial even with a global feature grant', async () => {
    mockRbac.getEffectiveFeatures.mockResolvedValue(['*'])
    registerAttachmentAccessResolvers([{ moduleId: 'attachments', resolvers: [{
      id: 'attachments.synthetic-owner', targetPartition: '*', targetEntity: 'attachments:library',
      resolve: async () => ({ ok: false, status: 404, reason: 'owner_denied' }),
    }] }])
    expect((await readBytes(path)).status).toBe(404)
    expect(mockResolveDriver).not.toHaveBeenCalled()
    expect(mockReadThumbnail).not.toHaveBeenCalled()
  })

  it('preserves global public anonymous bytes without consulting RBAC', async () => {
    jest.mocked(getAuthFromRequest).mockResolvedValue(null)
    mockPartition.isPublic = true
    mockAttachment.tenantId = null
    mockAttachment.organizationId = null
    const response = await readBytes(path)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/^public,/)
    expect(mockRbac.loadAcl).not.toHaveBeenCalled()
  })
})
