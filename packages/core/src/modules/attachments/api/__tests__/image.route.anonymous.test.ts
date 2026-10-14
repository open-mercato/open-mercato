/** @jest-environment node */

const mockSharp = jest.fn()
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => null),
}))

jest.mock('@open-mercato/core/modules/attachments/lib/requestScope', () => ({
  resolveAttachmentRequestScope: jest.fn(async () => ({ denied: false, organizationId: null })),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

const scopedLogo = {
  id: 'att-logo',
  mimeType: 'image/png',
  partitionCode: 'privateAttachments',
  storagePath: 'stored/logo.png',
  storageDriver: 'local',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

let partitionIsPublic = false

const mockEm = {
  findOne: jest.fn(async (_entity: unknown, where: { id?: string; code?: string }) => {
    if (where.id === 'att-logo') return scopedLogo
    if (where.code) return { code: where.code, isPublic: partitionIsPublic }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => (key === 'em' ? mockEm : null),
  })),
}))

type ImageRoute = typeof import('../image/[id]/[[...slug]]/route')

describe('attachments image route for an anonymous visitor', () => {
  let GET: ImageRoute['GET']

  beforeAll(async () => {
    GET = (await import('../image/[id]/[[...slug]]/route')).GET
  })

  it.each([
    ['a private partition', false],
    ['a public partition', true],
  ])('refuses a tenant-scoped image on %s', async (_label, isPublic) => {
    partitionIsPublic = isPublic

    const response = await GET(
      new Request('http://localhost/api/attachments/image/att-logo?width=640') as Parameters<ImageRoute['GET']>[0],
      { params: Promise.resolve({ id: 'att-logo' }) },
    )

    expect(response.status).toBe(401)
    expect(mockSharp).not.toHaveBeenCalled()
  })
})
