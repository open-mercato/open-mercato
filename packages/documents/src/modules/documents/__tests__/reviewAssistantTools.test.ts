import { DocumentFinding, DocumentReviewPlaybook, DocumentReviewPlaybookReference, DocumentReviewRule } from '../data/entities'

type Row = Record<string, unknown>
type Tier = 'owner' | 'editor' | 'commenter' | 'viewer' | null

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORGANIZATION_ID = '99999999-9999-4999-8999-999999999999'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const FINDING_ID = '55555555-5555-4555-8555-555555555555'
const RULE_ID = '66666666-6666-4666-8666-666666666666'
const PLAYBOOK_ID = '77777777-7777-4777-8777-777777777777'
const REFERENCE_ID = '88888888-8888-4888-8888-888888888888'
const UPDATED_AT = new Date('2026-11-12T10:00:00.000Z')

const mockState: {
  documents: Row[]
  tiers: Record<string, Tier>
  findings: Row[]
  rules: Row[]
  playbooks: Row[]
  references: Row[]
  routeCalls: Array<{ kind: string; url: string; method: string; body: unknown; params: unknown; auth: unknown }>
  routeResponse: { status: number; body: unknown }
} = {
  documents: [],
  tiers: {},
  findings: [],
  rules: [],
  playbooks: [],
  references: [],
  routeCalls: [],
  routeResponse: { status: 200, body: {} },
}

function mockMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) return row[key] === null || row[key] === undefined
    return row[key] === expected
  })
}

function mockRows(entity: unknown): Row[] {
  if (entity === DocumentFinding) return mockState.findings
  if (entity === DocumentReviewRule) return mockState.rules
  if (entity === DocumentReviewPlaybook) return mockState.playbooks
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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string, params?: Record<string, string>) =>
      Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), fallback ?? key),
  })),
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
  loadDocumentContent: jest.fn(async () => ({ yjsState: null, contentText: 'Guidance memo text.' })),
}))

jest.mock('../lib/reviewContent', () => ({
  extractReviewBlocksFromYjsState: jest.fn(() => []),
}))

function mockRoute(kind: string) {
  return async (request: Request, context: { params: unknown }) => {
    const symbols = Object.getOwnPropertySymbols(request)
    const envelope = symbols.length > 0 ? (request as unknown as Record<symbol, { auth?: unknown }>)[symbols[0]] : null
    const text = request.method === 'GET' ? '' : await request.text()
    mockState.routeCalls.push({
      kind,
      url: request.url,
      method: request.method,
      body: text ? JSON.parse(text) : null,
      params: context.params,
      auth: envelope?.auth ?? null,
    })
    return new Response(JSON.stringify(mockState.routeResponse.body), {
      status: mockState.routeResponse.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

jest.mock('../api/[id]/findings/route', () => ({ GET: mockRoute('list') }))
jest.mock('../api/[id]/findings/[findingId]/apply/route', () => ({ POST: mockRoute('apply') }))
jest.mock('../api/[id]/findings/[findingId]/keep/route', () => ({ POST: mockRoute('keep') }))
jest.mock('../api/[id]/findings/[findingId]/reopen/route', () => ({ POST: mockRoute('reopen') }))

import { aiTools } from '../ai-tools'
import { aiAgents } from '../ai-agents'
import {
  applyFinding,
  getReviewFinding,
  getReviewReference,
  keepFinding,
  listReviewFindings,
  previewApplyFinding,
  previewKeepFinding,
  previewReopenFinding,
  reopenFinding,
} from '../lib/reviewAssistantTools'
import type { DocumentsToolContext } from '../lib/reviewToolSupport'

function findingRow(overrides: Row = {}): Row {
  return {
    id: FINDING_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    source: 'agent',
    severity: 'blocking',
    title: 'Confidentiality term too long',
    explanation: 'Exceeds the standard position.',
    sectionLabel: '2. Obligations',
    quote: 'secret for five years',
    occurrence: 1,
    suggestedText: 'secret for two years',
    ruleId: RULE_ID,
    ruleCode: 'CONF-3.1',
    playbookId: PLAYBOOK_ID,
    playbookVersion: 2,
    anchorStatus: 'anchored',
    status: 'open',
    appliedText: null,
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdByUserId: USER_ID,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  }
}

function makeContext(overrides: Partial<DocumentsToolContext> = {}): DocumentsToolContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    container: { resolve: <T,>() => ({}) as T },
    userFeatures: ['documents.view', 'documents.edit'],
    isSuperAdmin: false,
    ...overrides,
  }
}

beforeEach(() => {
  mockState.documents = [
    { id: DOCUMENT_ID, title: 'Supplier agreement', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
    { id: REFERENCE_ID, title: 'Positions memo', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null },
  ]
  mockState.tiers = { [DOCUMENT_ID]: 'editor', [REFERENCE_ID]: 'viewer' }
  mockState.findings = [findingRow()]
  mockState.rules = [{
    id: RULE_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    code: 'CONF-3.1',
    title: 'Confidentiality term',
    topic: 'Term',
    position: 'Two years maximum.',
    preferredWording: 'secret for two years',
    severity: 'blocking',
  }]
  mockState.playbooks = [{
    id: PLAYBOOK_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    code: 'SUPPLY',
    name: 'Supply playbook',
    version: 3,
    deletedAt: null,
  }]
  mockState.references = [{
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    playbookId: PLAYBOOK_ID,
    documentId: REFERENCE_ID,
    deletedAt: null,
  }]
  mockState.routeCalls = []
  mockState.routeResponse = { status: 200, body: {} }
})

describe('review assistant agent and tool registration', () => {
  it('registers the chat agent with every tool it whitelists and a confirm-required policy', () => {
    const agent = aiAgents.find((candidate) => candidate.id === 'documents.review_assistant')
    expect(agent).toBeDefined()
    expect(agent?.executionMode).toBe('chat')
    expect(agent?.readOnly).toBe(false)
    expect(agent?.mutationPolicy).toBe('confirm-required')
    expect(agent?.requiredFeatures).toEqual(['documents.view'])
    const toolNames = new Set(aiTools.map((tool) => tool.name))
    for (const name of agent?.allowedTools ?? []) expect(toolNames.has(name)).toBe(true)
  })

  it('gates reads on documents.view and decisions on documents.edit with an approval preview', () => {
    const byName = new Map(aiTools.map((tool) => [tool.name, tool]))
    for (const name of ['documents.list_review_findings', 'documents.get_review_finding', 'documents.get_review_reference']) {
      expect(byName.get(name)?.isMutation).toBe(false)
      expect(byName.get(name)?.requiredFeatures).toEqual(['documents.view'])
    }
    for (const name of ['documents.apply_finding', 'documents.keep_finding', 'documents.reopen_finding']) {
      const tool = byName.get(name)
      expect(tool?.isMutation).toBe(true)
      expect(tool?.requiredFeatures).toContain('documents.edit')
      expect(typeof tool?.loadBeforeRecord).toBe('function')
    }
  })
})

describe('read tools', () => {
  it('lists findings through the findings route with filters, scoped to the tool principal', async () => {
    mockState.routeResponse = {
      status: 200,
      body: {
        items: [{ ...findingRow(), createdAt: UPDATED_AT.toISOString(), updatedAt: UPDATED_AT.toISOString(), anchor: null }],
        total: 1,
        reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        playbook: { id: PLAYBOOK_ID, code: 'SUPPLY', name: 'Supply playbook', version: 2 },
      },
    }
    const result = await listReviewFindings({ documentId: DOCUMENT_ID, status: 'open', severity: 'blocking', limit: 20 }, makeContext())
    expect(result.total).toBe(1)
    expect(result.findings[0]).toEqual(expect.objectContaining({ id: FINDING_ID, ruleCode: 'CONF-3.1', sectionLabel: '2. Obligations' }))
    expect(result.findings[0]).not.toHaveProperty('anchor')
    const call = mockState.routeCalls[0]
    const url = new URL(call.url)
    expect(url.pathname).toBe(`/api/documents/${DOCUMENT_ID}/findings`)
    expect(url.searchParams.get('status')).toBe('open')
    expect(url.searchParams.get('severity')).toBe('blocking')
    expect(url.searchParams.get('pageSize')).toBe('20')
    expect(call.params).toEqual({ id: DOCUMENT_ID })
    expect(call.auth).toEqual(expect.objectContaining({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID }))
  })

  it('surfaces the route refusal instead of returning data', async () => {
    mockState.routeResponse = { status: 404, body: { error: 'Document not found' } }
    await expect(listReviewFindings({ documentId: DOCUMENT_ID }, makeContext())).rejects.toThrow('Document not found')
  })

  it('rejects unknown filter values and calls without tenant scope', async () => {
    await expect(listReviewFindings({ documentId: DOCUMENT_ID, status: 'deleted' } as never, makeContext())).rejects.toThrow()
    await expect(listReviewFindings({ documentId: DOCUMENT_ID }, makeContext({ organizationId: null }))).rejects.toThrow('[internal]')
    expect(mockState.routeCalls).toHaveLength(0)
  })

  it('returns one finding with its rule and the viewable reference titles', async () => {
    const detail = await getReviewFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())
    expect(detail.rule).toEqual(expect.objectContaining({ code: 'CONF-3.1', position: 'Two years maximum.' }))
    expect(detail.playbook).toEqual({ code: 'SUPPLY', name: 'Supply playbook', version: 2 })
    expect(detail.references).toEqual([{ documentId: REFERENCE_ID, title: 'Positions memo' }])
  })

  it('hides findings from callers below the editor tier and from other organizations', async () => {
    mockState.tiers[DOCUMENT_ID] = 'commenter'
    await expect(getReviewFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('not found')
    mockState.tiers[DOCUMENT_ID] = 'editor'
    await expect(getReviewFinding(
      { documentId: DOCUMENT_ID, findingId: FINDING_ID },
      makeContext({ organizationId: OTHER_ORGANIZATION_ID }),
    )).rejects.toThrow('not found')
  })

  it('reads a reference only when it is linked to the playbook and viewable', async () => {
    const reference = await getReviewReference({ playbookCode: 'SUPPLY', documentId: REFERENCE_ID }, makeContext())
    expect(reference).toEqual(expect.objectContaining({ title: 'Positions memo', truncated: false }))
    expect(reference.blocks[0]?.text).toBe('Guidance memo text.')
    await expect(getReviewReference({ playbookCode: 'SUPPLY', documentId: DOCUMENT_ID }, makeContext())).rejects.toThrow('not found')
    mockState.tiers[REFERENCE_ID] = null
    await expect(getReviewReference({ playbookCode: 'SUPPLY', documentId: REFERENCE_ID }, makeContext())).rejects.toThrow('not found')
  })
})

describe('mutation tools', () => {
  it('previews apply with the suggestion or the drafted wording and the finding version', async () => {
    const preview = await previewApplyFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())
    expect(preview).toEqual(expect.objectContaining({
      recordId: FINDING_ID,
      entityType: 'documents:document_finding',
      recordVersion: UPDATED_AT.toISOString(),
      before: { decision: 'open', text: 'secret for five years' },
      after: { decision: 'applied', text: 'secret for two years' },
    }))
    expect(preview.display?.fieldLabels?.decision).toContain('Confidentiality term too long')
    expect(preview.display?.fieldLabels?.decision).toContain('CONF-3.1')
    const drafted = await previewApplyFinding(
      { documentId: DOCUMENT_ID, findingId: FINDING_ID, appliedText: 'secret for eighteen months' },
      makeContext(),
    )
    expect(drafted.after).toEqual({ decision: 'applied', text: 'secret for eighteen months' })
  })

  it('refuses to preview an apply the command would reject', async () => {
    mockState.findings = [findingRow({ status: 'kept' })]
    await expect(previewApplyFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('already decided')
    mockState.findings = [findingRow({ suggestedText: null })]
    await expect(previewApplyFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('no suggested wording')
    mockState.findings = [findingRow({ anchorStatus: 'unlocated' })]
    await expect(previewApplyFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('could not be found')
  })

  it('requires a note to keep a blocking finding and previews reopen only for decided findings', async () => {
    await expect(previewKeepFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('needs a note')
    const keep = await previewKeepFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID, note: 'Agreed with the counterparty' }, makeContext())
    expect(keep.after).toEqual({ decision: 'kept', note: 'Agreed with the counterparty' })
    await expect(previewReopenFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('Only an applied')
    mockState.findings = [findingRow({ status: 'applied' })]
    const reopen = await previewReopenFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())
    expect(reopen.before).toEqual({ decision: 'applied' })
    expect(reopen.after).toEqual({ decision: 'open' })
  })

  it('executes apply through the decision route with the previewed version and drafted text', async () => {
    mockState.routeResponse = { status: 200, body: { ...findingRow({ status: 'applied', appliedText: 'secret for eighteen months' }), createdAt: 'x', updatedAt: '2026-11-12T10:05:00.000Z' } }
    const previewed = '2026-11-12T09:59:00.000Z'
    const result = await applyFinding(
      { documentId: DOCUMENT_ID, findingId: FINDING_ID, appliedText: 'secret for eighteen months' },
      makeContext({ expectedRecordVersions: { [FINDING_ID]: previewed } }),
    )
    expect(result).toEqual(expect.objectContaining({ recordId: FINDING_ID, commandName: 'documents.finding.apply' }))
    expect(result.finding.status).toBe('applied')
    const call = mockState.routeCalls[0]
    expect(call.kind).toBe('apply')
    expect(call.method).toBe('POST')
    expect(new URL(call.url).pathname).toBe(`/api/documents/${DOCUMENT_ID}/findings/${FINDING_ID}/apply`)
    expect(call.params).toEqual({ id: DOCUMENT_ID, findingId: FINDING_ID })
    expect(call.body).toEqual({ expectedUpdatedAt: previewed, appliedText: 'secret for eighteen months' })
  })

  it('falls back to the suggestion and the current version when no preview version is known', async () => {
    mockState.routeResponse = { status: 200, body: { ...findingRow({ status: 'applied' }), createdAt: 'x', updatedAt: 'y' } }
    await applyFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())
    expect(mockState.routeCalls[0].body).toEqual({
      expectedUpdatedAt: UPDATED_AT.toISOString(),
      appliedText: 'secret for two years',
    })
  })

  it('sends keep notes and reopen through their routes and throws the route error on conflict', async () => {
    mockState.routeResponse = { status: 200, body: { ...findingRow({ status: 'kept' }), createdAt: 'x', updatedAt: 'y' } }
    await keepFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID, note: '  Accepted risk  ' }, makeContext())
    expect(mockState.routeCalls[0]).toEqual(expect.objectContaining({ kind: 'keep', body: { expectedUpdatedAt: UPDATED_AT.toISOString(), note: 'Accepted risk' } }))
    mockState.routeResponse = { status: 409, body: { error: 'Record changed by another user' } }
    await expect(reopenFinding({ documentId: DOCUMENT_ID, findingId: FINDING_ID }, makeContext())).rejects.toThrow('Record changed by another user')
    expect(mockState.routeCalls[1].kind).toBe('reopen')
  })
})
