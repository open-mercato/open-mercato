import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const mockSearch = jest.fn()
const mockSettings = {
  policy: { adapters: [], settleMode: 'quorum' },
  guardrails: {
    allowDomains: [] as string[],
    denyDomains: [] as string[],
    allowPrivateHosts: [] as string[],
    searchesPerRun: 10,
    fetchesPerRun: 10,
    callsPerTenantPerMinute: 60,
    maxFetchBytes: 1024,
  },
}

jest.mock('../policy', () => {
  const actual = jest.requireActual('../policy')
  return {
    ...actual,
    resolveWebSearchSettings: jest.fn(async () => mockSettings),
  }
})

jest.mock('../registry', () => ({
  buildWebSearchEngine: jest.fn(() => ({
    engine: { search: mockSearch, dispose: jest.fn(async () => undefined) },
    problems: [],
  })),
}))

jest.mock('../guardrails', () => ({
  chargeAdapterCalls: jest.fn(async () => undefined),
  chargeWebFetchBudget: jest.fn(async () => undefined),
  enforceWebSearchRateLimit: jest.fn(async () => ({ ok: true })),
  resolveRunId: jest.fn(async () => null),
  resolveSpentAdapterBudgets: jest.fn(async () => new Set()),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: jest.fn() })),
}))

jest.mock('../steps', () => ({
  createStepEmitter: jest.fn(() => () => undefined),
}))

import { webSearchTool } from '../tools'
import { POST as previewSearch } from '../../../api/web-search/preview/route'
import { ANSWER_WITHHELD_BY_DOMAIN_POLICY, withholdAnswerUnderDomainPolicy } from '../policy'

const ctx = {
  container: { resolve: () => { throw new Error('[internal] not registered') } },
  tenantId: 'tenant-1',
  organizationId: 'org-1',
} as unknown as McpToolContext

function engineResult(urls: string[], answer: string | null, cached = false) {
  return {
    results: urls.map((url, index) => ({ url, title: `Hit ${index}`, snippet: 'snippet', confidence: 0.9 })),
    answer,
    diagnostics: { adapters: [], degraded: false, cached, escalated: false, elapsedMs: 5, pagesRead: 0 },
  }
}

type ToolOutput = {
  ok: boolean
  results: Array<{ url: string }>
  answer: string | null
  diagnostics: { answerWithheld?: string; cached: boolean }
}

async function runSearch(): Promise<ToolOutput> {
  return (await webSearchTool.handler({ query: 'best crm' }, ctx)) as ToolOutput
}

describe('web search synthesized answer under domain policy', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    mockSettings.guardrails.allowDomains = []
    mockSettings.guardrails.denyDomains = []
  })

  it('withholds the answer under an allow-list and keeps only allowed hits', async () => {
    mockSettings.guardrails.allowDomains = ['allowed.example']
    mockSearch.mockResolvedValue(engineResult(['https://allowed.example/a', 'https://other.example/b'], 'Synthesized summary'))

    const output = await runSearch()

    expect(output.answer).toBeNull()
    expect(output.diagnostics.answerWithheld).toBe(ANSWER_WITHHELD_BY_DOMAIN_POLICY)
    expect(output.results.map((hit) => hit.url)).toEqual(['https://allowed.example/a'])
  })

  it('withholds the answer under a deny-list even when no returned hit was denied', async () => {
    mockSettings.guardrails.denyDomains = ['denied.example']
    mockSearch.mockResolvedValue(engineResult(['https://allowed.example/a'], 'Summary that may quote denied.example'))

    const output = await runSearch()

    expect(output.answer).toBeNull()
    expect(output.diagnostics.answerWithheld).toBe(ANSWER_WITHHELD_BY_DOMAIN_POLICY)
    expect(output.results.map((hit) => hit.url)).toEqual(['https://allowed.example/a'])
  })

  it('withholds the answer and drops denied hits when results are mixed', async () => {
    mockSettings.guardrails.denyDomains = ['denied.example']
    mockSearch.mockResolvedValue(engineResult(['https://denied.example/x', 'https://allowed.example/a'], 'Mixed summary'))

    const output = await runSearch()

    expect(output.answer).toBeNull()
    expect(output.results.map((hit) => hit.url)).toEqual(['https://allowed.example/a'])
  })

  it('withholds a cached answer when a policy is configured', async () => {
    mockSettings.guardrails.denyDomains = ['denied.example']
    mockSearch.mockResolvedValue(engineResult(['https://allowed.example/a'], 'Cached summary', true))

    const output = await runSearch()

    expect(output.diagnostics.cached).toBe(true)
    expect(output.answer).toBeNull()
    expect(output.diagnostics.answerWithheld).toBe(ANSWER_WITHHELD_BY_DOMAIN_POLICY)
  })

  it('passes the answer through when no domain policy is configured', async () => {
    mockSearch.mockResolvedValue(engineResult(['https://any.example/a'], 'Unfiltered summary'))

    const output = await runSearch()

    expect(output.answer).toBe('Unfiltered summary')
    expect(output.diagnostics.answerWithheld).toBeUndefined()
  })

  it('does not report a withheld answer when the provider gave none', async () => {
    mockSettings.guardrails.allowDomains = ['allowed.example']
    mockSearch.mockResolvedValue(engineResult(['https://allowed.example/a'], null))

    const output = await runSearch()

    expect(output.answer).toBeNull()
    expect(output.diagnostics.answerWithheld).toBeUndefined()
  })
})

describe('withholdAnswerUnderDomainPolicy', () => {
  it.each([
    [{ allowDomains: [], denyDomains: [] }, 'text', { answer: 'text' }],
    [{ allowDomains: ['a.example'], denyDomains: [] }, 'text', { answer: null, answerWithheld: 'domain_policy' }],
    [{ allowDomains: [], denyDomains: ['d.example'] }, 'text', { answer: null, answerWithheld: 'domain_policy' }],
    [{ allowDomains: ['a.example'], denyDomains: [] }, null, { answer: null }],
    [{ allowDomains: [], denyDomains: [] }, null, { answer: null }],
    [{ allowDomains: [], denyDomains: ['d.example'] }, '', { answer: null }],
  ])('guardrails %j with answer %j → %j', (guardrails, answer, expected) => {
    expect(withholdAnswerUnderDomainPolicy(answer, guardrails)).toEqual(expected)
  })
})

describe('web search settings preview', () => {
  beforeEach(() => {
    mockSearch.mockReset()
    mockSettings.guardrails.allowDomains = []
    mockSettings.guardrails.denyDomains = []
  })

  async function runPreview(): Promise<{ answer: string | null; answerWithheld?: string; byAdapter: Array<{ answer: string | null }> }> {
    const response = await previewSearch(new Request('http://localhost/api/agent_orchestrator/web-search/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'best crm' }),
    }))
    expect(response.status).toBe(200)
    return response.json()
  }

  it('withholds the top-level answer under a domain policy but keeps per-adapter answers for comparison', async () => {
    mockSettings.guardrails.denyDomains = ['denied.example']
    mockSearch.mockResolvedValue({
      ...engineResult(['https://allowed.example/a'], 'Fused summary'),
      byAdapter: [{ adapterId: 'tavily', weight: 1, answer: 'Raw adapter summary', results: [] }],
    })

    const body = await runPreview()

    expect(body.answer).toBeNull()
    expect(body.answerWithheld).toBe(ANSWER_WITHHELD_BY_DOMAIN_POLICY)
    expect(body.byAdapter[0].answer).toBe('Raw adapter summary')
  })

  it('returns the top-level answer when no domain policy is configured', async () => {
    mockSearch.mockResolvedValue({ ...engineResult(['https://any.example/a'], 'Fused summary'), byAdapter: [] })

    const body = await runPreview()

    expect(body.answer).toBe('Fused summary')
    expect(body.answerWithheld).toBeUndefined()
  })
})
