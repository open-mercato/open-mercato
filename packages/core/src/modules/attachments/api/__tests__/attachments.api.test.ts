/** @jest-environment node */
import { GET as list, POST as upload } from '@open-mercato/core/modules/attachments/api/route'

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
  find: jest.fn(),
}

const mockDataEngine = {
  setCustomFields: jest.fn(async () => {}),
  markOrmEntityChange: jest.fn(),
  flushOrmEntityChanges: jest.fn(async () => {}),
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
    mockEm.find.mockReset()
    mockEm.find.mockResolvedValue([])
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

  it('rejects files that exceed configured size limit', async () => {
    const oversized = new Uint8Array(2048)
    const file = new File([oversized], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(400)
    const payload = await res.json()
    expect(payload.error).toMatch(/exceeds/i)
  })

  it('applies normalized tags and assignments from form payload', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })
    const fd = fdWith(file)
    fd.set('tags', '["primary","primary ",""]')
    fd.set(
      'assignments',
      JSON.stringify([
        { type: 'catalog.products', id: 'prod-1', href: '/products/1', label: '' },
        { type: 'catalog.products', id: 'prod-1', href: '/products/1', label: ' Spec Sheet ' },
      ]),
    )
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fd as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item.tags).toEqual(['primary'])
    expect(body.item.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'catalog.products', id: 'prod-1', href: '/products/1', label: 'Spec Sheet' }),
        expect.objectContaining({ type: 'example:todo', id: 'r1' }),
      ]),
    )
  })

  it('lists attachments with sanitized metadata via GET', async () => {
    mockEm.find.mockResolvedValue([
      {
        id: 'att-1',
        entityId: 'example:todo',
        recordId: 'r1',
        organizationId: 'org',
        tenantId: 't1',
        fileName: ' doc.pdf ',
        url: 'http://cdn.local/doc.pdf',
        fileSize: 10,
        createdAt: '2024-01-01T00:00:00.000Z',
        partitionCode: 'privateAttachments',
        storageMetadata: { tags: ['primary', 'primary'], assignments: [{ type: 'catalog.products', id: 'prod-1' }] },
      },
    ])
    const req = new Request('http://x/api/attachments?entityId=example:todo&recordId=r1')
    const res = await list(req)
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toEqual(
      expect.objectContaining({
        id: 'att-1',
        tags: ['primary'],
        assignments: [{ type: 'catalog.products', id: 'prod-1' }],
        thumbnailUrl: expect.stringContaining('att-1'),
      }),
    )
    expect(mockEm.find).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ entityId: 'example:todo', recordId: 'r1' }),
      expect.any(Object),
    )
  })
})
