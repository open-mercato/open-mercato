import type { ReviewBlock } from '../lib/reviewContent'
import {
  DocumentReviewPlaybook,
  DocumentReviewPlaybookReference,
  DocumentReviewRule,
} from '../data/entities'

type Row = Record<string, unknown>
type Tier = 'owner' | 'editor' | 'commenter' | 'viewer' | null

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '99999999-9999-4999-8999-999999999999'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const GUIDANCE_VISIBLE_ID = '55555555-5555-4555-8555-555555555555'
const GUIDANCE_HIDDEN_ID = '66666666-6666-4666-8666-666666666666'
const PLAYBOOK_ID = '77777777-7777-4777-8777-777777777777'

const mockState: {
  documents: Row[]
  tiers: Record<string, Tier>
  blocks: Record<string, ReviewBlock[]>
  contentText: Record<string, string>
  playbooks: Row[]
  rules: Row[]
  references: Row[]
} = { documents: [], tiers: {}, blocks: {}, contentText: {}, playbooks: [], rules: [], references: [] }

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) return row[key] === null || row[key] === undefined
    return row[key] === expected
  })
}

function mockRows(entity: unknown): Row[] {
  if (entity === DocumentReviewPlaybook) return mockState.playbooks
  if (entity === DocumentReviewRule) return mockState.rules
  if (entity === DocumentReviewPlaybookReference) return mockState.references
  return []
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) => (
    mockRows(entity).filter((row) => mockMatches(row, where))
  )),
  findOneWithDecryption: jest.fn(async (_em: unknown, entity: unknown, where: Row) => (
    mockRows(entity).find((row) => mockMatches(row, where)) ?? null
  )),
}))

jest.mock('../lib/permissions', () => {
  const actual = jest.requireActual('../lib/permissions')
  return {
    ...actual,
    loadScopedDocument: jest.fn(async (_em: unknown, documentId: string, scope: { tenantId: string; organizationId: string }) => (
      mockState.documents.find((row) => (
        row.id === documentId && row.tenantId === scope.tenantId && row.organizationId === scope.organizationId
      )) ?? null
    )),
    resolveLoadedDocumentUserAccess: jest.fn(async (_em: unknown, document: Row) => mockState.tiers[document.id as string] ?? null),
  }
})

jest.mock('../lib/contentService', () => ({
  loadDocumentContent: jest.fn(async (_em: unknown, documentId: string) => ({
    yjsState: Buffer.from(documentId),
    contentText: mockState.contentText[documentId] ?? null,
  })),
}))

jest.mock('../lib/reviewContent', () => ({
  extractReviewBlocksFromYjsState: jest.fn((state: Buffer) => mockState.blocks[state.toString()] ?? []),
}))

import {
  aiTools,
  capReviewBlocks,
  getDocumentForReview,
  getReviewPlaybook,
  type DocumentsToolContext,
} from '../ai-tools'
import {
  DOCUMENTS_REVIEW_TOOL_MAX_DOCUMENT_CHARS,
  DOCUMENTS_REVIEW_TOOL_MAX_GUIDANCE_CHARS,
} from '../lib/resourceLimits'

function documentRow(id: string, title: string, organizationId = ORGANIZATION_ID): Row {
  return { id, title, tenantId: TENANT_ID, organizationId, updatedAt: new Date('2026-11-12T10:00:00.000Z'), deletedAt: null }
}

function block(index: number, text: string, sectionLabel = '1. Definitions'): ReviewBlock {
  return { index, kind: 'paragraph', sectionLabel, text }
}

function makeContext(overrides: Partial<DocumentsToolContext> = {}): DocumentsToolContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    container: { resolve: <T,>() => ({}) as T },
    userFeatures: ['documents.view'],
    isSuperAdmin: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockState.documents = [
    documentRow(DOCUMENT_ID, 'Mutual NDA'),
    documentRow(GUIDANCE_VISIBLE_ID, 'NDA positions memo'),
    documentRow(GUIDANCE_HIDDEN_ID, 'Restricted memo'),
  ]
  mockState.tiers = { [DOCUMENT_ID]: 'viewer', [GUIDANCE_VISIBLE_ID]: 'commenter', [GUIDANCE_HIDDEN_ID]: null }
  mockState.blocks = {
    [DOCUMENT_ID]: [
      { index: 0, kind: 'heading', level: 1, sectionLabel: '1. Definitions', text: '1. Definitions' },
      block(1, 'Confidential Information means any information disclosed by either party.'),
    ],
    [GUIDANCE_VISIBLE_ID]: [block(0, 'Term: two years.'), block(1, 'Governing law: home jurisdiction.')],
    [GUIDANCE_HIDDEN_ID]: [block(0, 'Secret positions.')],
  }
  mockState.contentText = {}
  mockState.playbooks = [{
    id: PLAYBOOK_ID,
    code: 'nda',
    name: 'NDA playbook',
    version: 3,
    instructions: 'Review mutual NDAs.',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    isActive: true,
    deletedAt: null,
  }]
  mockState.rules = [
    {
      id: 'r1', playbookId: PLAYBOOK_ID, code: 'term', title: 'Term', topic: 'Duration', position: 'At most two years.',
      preferredWording: 'for a period of two years', severity: 'blocking', tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID, isActive: true, deletedAt: null,
    },
    {
      id: 'r2', playbookId: PLAYBOOK_ID, code: 'retired', title: 'Retired', topic: null, position: 'Old rule.',
      preferredWording: null, severity: 'info', tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID, isActive: false, deletedAt: null,
    },
  ]
  mockState.references = [
    { id: 'f1', playbookId: PLAYBOOK_ID, documentId: GUIDANCE_VISIBLE_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    { id: 'f2', playbookId: PLAYBOOK_ID, documentId: GUIDANCE_HIDDEN_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
  ]
})

describe('documents review AI tools', () => {
  it('registers two read-only tools gated on documents.view without attachment inputs', () => {
    const reviewTools = aiTools.filter((tool) => (
      tool.name === 'documents.get_document_for_review' || tool.name === 'documents.get_review_playbook'
    ))
    expect(reviewTools.map((tool) => tool.name)).toEqual([
      'documents.get_document_for_review',
      'documents.get_review_playbook',
    ])
    for (const tool of reviewTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures).toEqual(['documents.view'])
      expect(tool.inputSchema.safeParse({ attachmentId: DOCUMENT_ID }).success).toBe(false)
    }
  })

  it('returns review blocks for a document the principal can view', async () => {
    const result = await getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext())
    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      title: 'Mutual NDA',
      updatedAt: '2026-11-12T10:00:00.000Z',
      truncated: false,
      blocks: mockState.blocks[DOCUMENT_ID],
    })
  })

  it('falls back to the plain text when the document has no collaboration state', async () => {
    mockState.blocks[DOCUMENT_ID] = []
    mockState.contentText[DOCUMENT_ID] = '  Plain   body text. '
    const result = await getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext())
    expect(result.blocks).toEqual([{ index: 0, kind: 'paragraph', sectionLabel: '', text: 'Plain body text.' }])
  })

  it('denies a document the principal has no tier on', async () => {
    mockState.tiers[DOCUMENT_ID] = null
    await expect(getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext())).rejects.toThrow('Document not found')
  })

  it('denies a document from another organization', async () => {
    mockState.documents = [documentRow(DOCUMENT_ID, 'Mutual NDA', OTHER_ORGANIZATION_ID)]
    await expect(getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext())).rejects.toThrow('Document not found')
  })

  it('requires tenant, organization and user context', async () => {
    await expect(getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext({ userId: null }))).rejects.toThrow('[internal]')
    await expect(getReviewPlaybook({ code: 'nda' }, makeContext({ organizationId: null }))).rejects.toThrow('[internal]')
  })

  it('caps the document text and flags truncation', async () => {
    const head = DOCUMENTS_REVIEW_TOOL_MAX_DOCUMENT_CHARS - 40
    mockState.blocks[DOCUMENT_ID] = [
      block(0, 'a'.repeat(head)),
      block(1, 'b'.repeat(100)),
      block(2, 'c'.repeat(100)),
      block(3, 'd'.repeat(10)),
    ]
    const result = await getDocumentForReview({ documentId: DOCUMENT_ID }, makeContext())
    expect(result.truncated).toBe(true)
    const total = result.blocks.reduce((sum, item) => sum + item.text.length, 0)
    expect(total).toBe(DOCUMENTS_REVIEW_TOOL_MAX_DOCUMENT_CHARS)
    expect(result.blocks.map((item) => item.index)).toEqual([0, 1])
    expect(result.blocks[1]?.text).toBe('b'.repeat(40))
  })

  it('caps blocks exactly at the limit without flagging truncation', () => {
    expect(capReviewBlocks([block(0, 'abc'), block(1, 'de')], 5)).toEqual({
      blocks: [block(0, 'abc'), block(1, 'de')],
      truncated: false,
    })
    expect(capReviewBlocks([block(0, 'abc'), block(1, 'de')], 3)).toEqual({ blocks: [block(0, 'abc')], truncated: true })
  })

  it('returns active rules and only the guidance documents the principal can view', async () => {
    const result = await getReviewPlaybook({ code: 'nda' }, makeContext())
    expect(result).toEqual({
      code: 'nda',
      name: 'NDA playbook',
      version: 3,
      instructions: 'Review mutual NDAs.',
      rules: [{
        code: 'term',
        title: 'Term',
        topic: 'Duration',
        position: 'At most two years.',
        preferredWording: 'for a period of two years',
        severity: 'blocking',
      }],
      guidance: [{
        documentId: GUIDANCE_VISIBLE_ID,
        title: 'NDA positions memo',
        text: 'Term: two years.\nGoverning law: home jurisdiction.',
        truncated: false,
      }],
    })
  })

  it('caps each guidance document', async () => {
    mockState.blocks[GUIDANCE_VISIBLE_ID] = [block(0, 'g'.repeat(DOCUMENTS_REVIEW_TOOL_MAX_GUIDANCE_CHARS + 50))]
    const result = await getReviewPlaybook({ code: 'nda' }, makeContext())
    expect(result.guidance[0]?.text).toHaveLength(DOCUMENTS_REVIEW_TOOL_MAX_GUIDANCE_CHARS)
    expect(result.guidance[0]?.truncated).toBe(true)
  })

  it('does not return a playbook from another organization or an inactive one', async () => {
    await expect(getReviewPlaybook({ code: 'nda' }, makeContext({ organizationId: OTHER_ORGANIZATION_ID })))
      .rejects.toThrow('Review playbook not found')
    mockState.playbooks[0] = { ...mockState.playbooks[0], isActive: false }
    await expect(getReviewPlaybook({ code: 'nda' }, makeContext())).rejects.toThrow('Review playbook not found')
  })
})
