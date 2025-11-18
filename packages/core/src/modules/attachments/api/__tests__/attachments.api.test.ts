/** @jest-environment node */
import { POST as upload } from '@open-mercato/core/modules/attachments/api/attachments'

const partitions = [
  { id: 'p-private', code: 'privateAttachments', title: 'Private', isPublic: false, storageDriver: 'local' },
  { id: 'p-products', code: 'productsMedia', title: 'Products', isPublic: true, storageDriver: 'local' },
]

const mockEm = {
  findOne: jest.fn(async (entity: any, where: any) => {
    if (entity?.name === 'AttachmentPartition') {
      return partitions.find((p) => p.code === where?.code) ?? null
    }
    if (entity?.name === 'CustomFieldDef') {
      return { configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['pdf'] } }
    }
    return null
  }),
  create: jest.fn((_cls: any, data: any) => ({ ...data })),
  persistAndFlush: jest.fn(async () => {}),
  getRepository: jest.fn(() => ({
    findAll: jest.fn(async () => partitions),
    create: jest.fn((data: any) => data),
  })),
  persist: jest.fn(),
  flush: jest.fn(),
}

const mockDataEngine = {
  setCustomFields: jest.fn(async () => {}),
}

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'dataEngine') return mockDataEngine
      return null
    },
  }),
}))

jest.mock('@/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

// Avoid touching disk
import { promises as fsp } from 'fs'
jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined as any)
jest.spyOn(fsp, 'writeFile').mockResolvedValue(undefined as any)

// Avoid loading MikroORM decorators in tests
jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

function fdWith(file: File, extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('entityId', 'example:todo')
  fd.set('recordId', 'r1')
  fd.set('fieldKey', 'attachments')
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  fd.set('file', file)
  return fd
}

describe('attachments API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects disallowed extension', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'img.png', { type: 'image/png' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toMatch(/not allowed/i)
  })

  it('accepts allowed small pdf', async () => {
    const file = new File([new Uint8Array([1,2,3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', {
      method: 'POST',
      body: fdWith(file, { customFields: JSON.stringify({ altText: 'Product spec' }) }) as any,
    })
    const res = await upload(req)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j?.ok).toBe(true)
    expect(j?.item?.customFields).toEqual({ altText: 'Product spec' })
    const payload = mockEm.create.mock.calls[mockEm.create.mock.calls.length - 1]?.[1]
    expect(payload?.storageMetadata?.assignments).toEqual([{ type: 'example:todo', id: 'r1' }])
    expect(mockDataEngine.setCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: expect.any(String),
        recordId: expect.any(String),
        values: { altText: 'Product spec' },
      }),
    )
  })
})
