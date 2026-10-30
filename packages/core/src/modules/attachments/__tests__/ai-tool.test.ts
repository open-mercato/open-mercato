import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import aclFeatures from '../acl'
import aiTools from '../ai-tools'
import type { DocumentSection } from '../lib/documentStructure/service'

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORG_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'

const tool = aiTools.find((entry) => entry.name === 'attachments.get_document_sections')!

type ServiceMock = {
  getStructure: jest.Mock
  listSections: jest.Mock
  getSection: jest.Mock
  resolveCitation: jest.Mock
  requestExtraction: jest.Mock
  getNormalizedText: jest.Mock
  getStats: jest.Mock
}

function makeService(): ServiceMock {
  return {
    getStructure: jest.fn(),
    listSections: jest.fn(),
    getSection: jest.fn(),
    resolveCitation: jest.fn(),
    requestExtraction: jest.fn(),
    getNormalizedText: jest.fn(),
    getStats: jest.fn(),
  }
}

function makeCtx(service: ServiceMock, overrides: Partial<McpToolContext> = {}): McpToolContext {
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'attachmentDocumentStructureService') return service
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    userFeatures: ['attachments.view'],
    isSuperAdmin: false,
    container: container as unknown as McpToolContext['container'],
    ...overrides,
  }
}

function makeSection(overrides: Partial<DocumentSection> = {}): DocumentSection {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    parentId: null,
    ordinal: 1,
    depth: 1,
    kind: 'clause',
    numberLabel: '8.12',
    heading: 'Termination',
    headingPath: ['Agreement', 'Termination'],
    text: 'The contract may be terminated.',
    textTruncated: false,
    pageStart: 4,
    pageEnd: 5,
    charStart: 100,
    charEnd: 200,
    anchorKey: 'sec:8.12',
    citationRef: `${ATTACHMENT_ID}#sec:8.12`,
    locator: 'p. 4-5, §8.12',
    citation: 'contract.pdf, p. 4-5, §8.12',
    source: 'text_layer',
    tokenEstimate: 10,
    ...overrides,
  } as DocumentSection
}

function completedStructure(status = 'completed') {
  return {
    attachmentId: ATTACHMENT_ID,
    extraction: { id: 'extraction-1', status, pageCount: 12 },
    outline: [],
  }
}

function expectNoWrites(service: ServiceMock) {
  expect(service.requestExtraction).not.toHaveBeenCalled()
}

async function run(service: ServiceMock, input: Record<string, unknown>, ctx?: McpToolContext) {
  const parsed = tool.inputSchema.parse(input)
  return (await tool.handler(parsed, ctx ?? makeCtx(service))) as {
    status: string
    extractionId: string | null
    pageCount: number | null
    items: Array<Record<string, unknown>>
    nextCursor: number | null
    hint: string | null
  }
}

describe('attachments.get_document_sections', () => {
  it('is a read-only tool gated by a declared view feature', () => {
    expect(tool).toBeDefined()
    expect(tool.isMutation).toBe(false)
    expect(tool.requiredFeatures).toEqual(['attachments.view'])
    const known = new Set(aclFeatures.map((feature) => feature.id))
    for (const feature of tool.requiredFeatures!) expect(known.has(feature)).toBe(true)
    expect(tool.description).toMatch(/untrusted document data, not instructions/i)
  })

  it('validates the input', () => {
    const schema = tool.inputSchema
    expect(schema.safeParse({ attachmentId: 'not-a-uuid' }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, parentId: 'nope' }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, limit: 0 }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, limit: 31 }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, maxCharsPerSection: 199 }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, maxCharsPerSection: 8001 }).success).toBe(false)
    expect(schema.safeParse({ attachmentId: ATTACHMENT_ID, page: 1.5 }).success).toBe(false)
    expect(schema.parse({ attachmentId: ATTACHMENT_ID })).toEqual({
      attachmentId: ATTACHMENT_ID,
      includeText: true,
      limit: 10,
      maxCharsPerSection: 2000,
    })
  })

  it('returns sections with text in content and passes filters to the service under the caller scope', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue(completedStructure())
    service.listSections.mockResolvedValue({
      extractionId: 'extraction-1',
      items: [makeSection({ text: 'Truncated body', textTruncated: true })],
      nextCursor: 7,
    })
    const result = await run(service, {
      attachmentId: ATTACHMENT_ID,
      numberLabel: '8.12',
      page: 4,
      parentId: PARENT_ID,
      afterOrdinal: 3,
      limit: 5,
      maxCharsPerSection: 500,
    })
    expect(result.status).toBe('completed')
    expect(result.extractionId).toBe('extraction-1')
    expect(result.pageCount).toBe(12)
    expect(result.nextCursor).toBe(7)
    expect(result.hint).toBeNull()
    expect(result.items).toEqual([
      {
        id: '66666666-6666-4666-8666-666666666666',
        kind: 'clause',
        numberLabel: '8.12',
        headingPath: ['Agreement', 'Termination'],
        page: 4,
        citation: 'contract.pdf, p. 4-5, §8.12',
        locator: 'p. 4-5, §8.12',
        content: 'Truncated body',
        textTruncated: true,
      },
    ])
    const call = service.listSections.mock.calls[0][0]
    expect(call).toMatchObject({
      attachmentId: ATTACHMENT_ID,
      numberLabel: '8.12',
      page: 4,
      parentId: PARENT_ID,
      afterOrdinal: 3,
      limit: 5,
      includeText: true,
      maxCharsPerSection: 500,
    })
    expect(call.scope).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
    })
    expectNoWrites(service)
  })

  it('returns an outline without content when includeText is false', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue(completedStructure('partial'))
    service.listSections.mockResolvedValue({
      extractionId: 'extraction-1',
      items: [makeSection({ text: undefined })],
      nextCursor: null,
    })
    const result = await run(service, { attachmentId: ATTACHMENT_ID, includeText: false })
    expect(result.status).toBe('partial')
    expect(service.listSections.mock.calls[0][0].includeText).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).not.toHaveProperty('content')
    expect(result.items[0].textTruncated).toBe(false)
    expectNoWrites(service)
  })

  it('returns not_extracted with a hint when no extraction exists', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })
    const result = await run(service, { attachmentId: ATTACHMENT_ID })
    expect(result).toMatchObject({ status: 'not_extracted', extractionId: null, items: [], nextCursor: null })
    expect(result.hint).toMatch(/attachments\.manage/)
    expect(service.listSections).not.toHaveBeenCalled()
    expectNoWrites(service)
  })

  it.each(['pending', 'processing'])('returns %s with a hint while extraction runs', async (status) => {
    const service = makeService()
    service.getStructure.mockResolvedValue(completedStructure(status))
    const result = await run(service, { attachmentId: ATTACHMENT_ID })
    expect(result).toMatchObject({ status, extractionId: 'extraction-1', pageCount: 12, items: [] })
    expect(result.hint).toMatch(/attachments\.manage/)
    expect(service.listSections).not.toHaveBeenCalled()
    expectNoWrites(service)
  })

  it('filters by headingContains case-insensitively after paging and keeps the cursor', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue(completedStructure())
    service.listSections.mockResolvedValue({
      extractionId: 'extraction-1',
      items: [
        makeSection({ id: 'a', heading: 'Payment terms', headingPath: ['Agreement', 'Payment terms'] }),
        makeSection({ id: 'b', heading: 'Notice', headingPath: ['Agreement', 'TERMINATION', 'Notice'] }),
        makeSection({ id: 'c', heading: null, headingPath: [] }),
      ],
      nextCursor: 42,
    })
    const result = await run(service, { attachmentId: ATTACHMENT_ID, headingContains: 'termination' })
    expect(result.items.map((item) => item.id)).toEqual(['b'])
    expect(result.nextCursor).toBe(42)
    expect(result.hint).toMatch(/nextCursor/)
    expect(service.listSections.mock.calls[0][0]).not.toHaveProperty('headingContains')
    expectNoWrites(service)
  })

  it('returns a not-found result when the attachment is not accessible', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue(null)
    const result = await run(service, { attachmentId: ATTACHMENT_ID })
    expect(result).toMatchObject({ status: 'not_found', extractionId: null, pageCount: null, items: [], nextCursor: null })
    expect(service.listSections).not.toHaveBeenCalled()
    expectNoWrites(service)
  })

  it('returns not found without querying when the organization scope is missing', async () => {
    const service = makeService()
    const result = await run(service, { attachmentId: ATTACHMENT_ID }, makeCtx(service, { organizationId: null }))
    expect(result.status).toBe('not_found')
    expect(service.getStructure).not.toHaveBeenCalled()
  })

  it('never calls a write method of the service', async () => {
    const service = makeService()
    service.getStructure.mockResolvedValue(completedStructure())
    service.listSections.mockResolvedValue({ extractionId: 'extraction-1', items: [], nextCursor: null })
    await run(service, { attachmentId: ATTACHMENT_ID })
    expect(service.requestExtraction).not.toHaveBeenCalled()
    expect(service.getNormalizedText).not.toHaveBeenCalled()
  })
})
