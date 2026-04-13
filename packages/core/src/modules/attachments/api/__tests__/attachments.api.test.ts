/** @jest-environment node */
jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    attachments: { attachment: 'attachments:attachment' },
    catalog: { catalog_product: 'catalog:catalog_product' },
  },
}))

const partitions = [
  { id: 'p-private', code: 'privateAttachments', title: 'Private', isPublic: false, storageDriver: 'local', requiresOcr: true },
  { id: 'p-products', code: 'productsMedia', title: 'Products', isPublic: true, storageDriver: 'local', requiresOcr: false },
]

const defaultFindOneImpl = async (entity: any, where: any) => {
  if (entity?.name === 'AttachmentPartition') {
    return partitions.find((p) => p.code === where?.code) ?? null
  }
  if (entity?.name === 'CustomFieldDef') {
    return { configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['pdf', 'docx'] } }
  }
  return null
}

const mockEm = {
  findOne: jest.fn(defaultFindOneImpl),
  create: jest.fn((_cls: any, data: any) => ({ ...data })),
  persistAndFlush: jest.fn(async () => {}),
  getRepository: jest.fn(() => ({
    findAll: jest.fn(async () => partitions),
    create: jest.fn((data: any) => data),
  })),
  persist: jest.fn(),
  flush: jest.fn(),
  find: jest.fn(),
  getConnection: jest.fn(() => ({
    getKnex: () => {
      const query = {
        where: jest.fn(() => query),
        sum: jest.fn(() => query),
        first: jest.fn(async () => ({ totalSize: 0 })),
      }
      return jest.fn(() => query)
    },
  })),
}

const defaultFindOneImplementation = mockEm.findOne.getMockImplementation()

const mockDataEngine = {
  setCustomFields: jest.fn(async () => {}),
  markOrmEntityChange: jest.fn(),
  flushOrmEntityChanges: jest.fn(async () => {}),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (k: string) => {
      if (k === 'em') return mockEm
      if (k === 'dataEngine') return mockDataEngine
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (_key: string, fallback: string) => fallback,
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

// Avoid touching disk
import { promises as fsp } from 'fs'
jest.spyOn(fsp, 'mkdir').mockResolvedValue(undefined as any)
jest.spyOn(fsp, 'writeFile').mockResolvedValue(undefined as any)

jest.mock('@open-mercato/core/modules/attachments/lib/textExtraction', () => ({
  extractAttachmentContent: jest.fn(),
}))
const mockExtractAttachmentContent = jest.requireMock('@open-mercato/core/modules/attachments/lib/textExtraction')
  .extractAttachmentContent as jest.Mock

jest.mock('@open-mercato/core/modules/attachments/lib/ocrQueue', () => ({
  requestOcrProcessing: jest.fn(async () => {}),
}))
const mockRequestOcrProcessing = jest.requireMock('@open-mercato/core/modules/attachments/lib/ocrQueue')
  .requestOcrProcessing as jest.Mock

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

async function loadHandlers() {
  return import('@open-mercato/core/modules/attachments/api/route')
}

describe('attachments API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.findOne.mockReset()
    mockEm.findOne.mockImplementation(defaultFindOneImpl)
    mockEm.find.mockReset()
    mockEm.find.mockResolvedValue([])
    mockExtractAttachmentContent.mockReset()
    delete process.env.OM_DEFAULT_ATTACHMENT_OCR_ENABLED
    delete process.env.OM_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OM_ATTACHMENT_TENANT_QUOTA_MB
    delete process.env.OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED
    delete process.env.OPENMERCATO_ATTACHMENT_MAX_UPLOAD_MB
    delete process.env.OPENMERCATO_ATTACHMENT_TENANT_QUOTA_MB
    mockEm.getConnection.mockReturnValue({
      getKnex: () => {
        const query = {
          where: jest.fn(() => query),
          sum: jest.fn(() => query),
          first: jest.fn(async () => ({ totalSize: 0 })),
        }
        return jest.fn(() => query)
      },
    })
    mockRequestOcrProcessing.mockReset()
    mockRequestOcrProcessing.mockImplementation(async () => {})
    delete process.env.OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED
    delete process.env.OPENAI_API_KEY
  })

  it('rejects disallowed extension', async () => {
    const { POST: upload } = await loadHandlers()
    const file = new File([new Uint8Array([1,2,3])], 'img.png', { type: 'image/png' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.error).toMatch(/not allowed/i)
  })

  it('rejects active content uploads even when the client claims a safe image mime type', async () => {
    const file = new File(
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8')],
      'avatar.jpg',
      { type: 'image/jpeg' },
    )
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file, { fieldKey: '' }) as any })
    const res = await upload(req)
    expect(res.status).toBe(400)
    const payload = await res.json()
    expect(payload.error).toMatch(/active content/i)
  })

  it('accepts allowed small pdf', async () => {
    const { POST: upload } = await loadHandlers()
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
    const { POST: upload } = await loadHandlers()
    const oversized = new Uint8Array(2048)
    const file = new File([oversized], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(413)
    const payload = await res.json()
    expect(payload.error).toMatch(/exceeds/i)
  })

  it('rejects files that exceed the default global upload limit without field config', async () => {
    const { POST: upload } = await loadHandlers()
    process.env.OM_ATTACHMENT_MAX_UPLOAD_MB = '0.0005'
    const file = new File([new Uint8Array(1024)], 'doc.pdf', { type: 'application/pdf' })
    const fd = new FormData()
    fd.set('entityId', 'example:todo')
    fd.set('recordId', 'r1')
    fd.set('file', file)
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fd as any })
    const res = await upload(req)
    expect(res.status).toBe(413)
    const payload = await res.json()
    expect(payload.error).toMatch(/maximum upload size/i)
  })

  it('rejects uploads that exceed the tenant storage quota', async () => {
    const { POST: upload } = await loadHandlers()
    process.env.OM_ATTACHMENT_TENANT_QUOTA_MB = '0.001'
    mockEm.getConnection.mockReturnValue({
      getKnex: () => {
        const query = {
          where: jest.fn(() => query),
          sum: jest.fn(() => query),
          first: jest.fn(async () => ({ totalSize: 1000 })),
        }
        return jest.fn(() => query)
      },
    })
    const file = new File([new Uint8Array(200)], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(413)
    const payload = await res.json()
    expect(payload.error).toMatch(/quota exceeded/i)
  })

  it('extracts content when partition requires OCR', async () => {
    const { POST: upload } = await loadHandlers()
    mockExtractAttachmentContent.mockResolvedValue('extracted text')
    const file = new File(
      [new Uint8Array([1, 2, 3])],
      'doc.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    )
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).toHaveBeenCalled()
    const payload = mockEm.create.mock.calls.find((call) => call[0].name === 'Attachment')?.[1]
    expect(payload?.content).toBe('extracted text')
  })

  it('skips OCR when partition disables it', async () => {
    const { POST: upload } = await loadHandlers()
    const disabledPartition = { ...partitions[0], requiresOcr: false }
    mockEm.findOne.mockImplementation(async (entity: any, where: any) => {
      if (entity?.name === 'AttachmentPartition') return disabledPartition
      if (entity?.name === 'CustomFieldDef') {
        return { configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['pdf'] } }
      }
      return null
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).not.toHaveBeenCalled()
    const payload = mockEm.create.mock.calls.find((call) => call[0].name === 'Attachment')?.[1]
    expect(payload?.content ?? null).toBeNull()
  })

  it('queues LLM OCR for uploaded PDFs when OpenAI is configured', async () => {
    const { POST: upload } = await loadHandlers()
    process.env.OPENAI_API_KEY = 'test-key'
    mockExtractAttachmentContent.mockResolvedValue('pdf text')
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).not.toHaveBeenCalled()
    expect(mockRequestOcrProcessing).toHaveBeenCalledTimes(1)
  })

  it('falls back to text extraction for uploaded PDFs when OpenAI is missing', async () => {
    const { POST: upload } = await loadHandlers()
    mockExtractAttachmentContent.mockResolvedValue('pdf text')
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).toHaveBeenCalled()
    expect(mockRequestOcrProcessing).not.toHaveBeenCalled()
  })

  it('queues LLM OCR for uploaded images when OpenAI is configured', async () => {
    const { POST: upload } = await loadHandlers()
    process.env.OPENAI_API_KEY = 'test-key'
    mockEm.findOne.mockImplementation(async (entity: any, where: any) => {
      if (entity?.name === 'AttachmentPartition') {
        return partitions.find((p) => p.code === where?.code) ?? null
      }
      if (entity?.name === 'CustomFieldDef') {
        return { configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['png', 'pdf', 'docx'] } }
      }
      return null
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'scan.png', { type: 'image/png' })
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).not.toHaveBeenCalled()
    expect(mockRequestOcrProcessing).toHaveBeenCalledTimes(1)
  })

  it('uses env default when partition flag is undefined', async () => {
    const { POST: upload } = await loadHandlers()
    delete process.env.OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED
    mockExtractAttachmentContent.mockResolvedValue('default text')
    const partitionWithoutFlag = { ...partitions[0] }
    delete (partitionWithoutFlag as any).requiresOcr
    mockEm.findOne.mockImplementation(async (entity: any, where: any) => {
      if (entity?.name === 'AttachmentPartition') return partitionWithoutFlag
      if (entity?.name === 'CustomFieldDef') {
        return { configJson: { maxAttachmentSizeMb: 0.001, acceptExtensions: ['pdf', 'docx'] } }
      }
      return null
    })
    const file = new File(
      [new Uint8Array([1, 2, 3])],
      'doc.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    )
    const req = new Request('http://x/api/attachments', { method: 'POST', body: fdWith(file) as any })
    const res = await upload(req)
    expect(res.status).toBe(200)
    expect(mockExtractAttachmentContent).toHaveBeenCalled()
  })

  it('applies normalized tags and assignments from form payload', async () => {
    const { POST: upload } = await loadHandlers()
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

  it('rejects explicit uploads to unrelated public partitions', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' })
    const req = new Request(
      'http://x/api/attachments',
      { method: 'POST', body: fdWith(file, { partitionCode: 'productsMedia' }) as any },
    )
    const res = await upload(req)
    expect(res.status).toBe(403)
    const payload = await res.json()
    expect(payload.error).toMatch(/public storage partitions/i)
  })

  it('lists attachments with sanitized metadata via GET', async () => {
    const { GET: list } = await loadHandlers()
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
