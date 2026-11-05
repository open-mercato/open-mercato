import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { SearchEngineResult, SearchResult } from '@open-mercato/web-research'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { buildWebSearchEngine } from '../lib/webSearch/registry'
import { webSearchTool } from '../lib/webSearch/tools'
import { POST } from '../api/web-search/preview/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('../lib/webSearch/registry', () => ({ buildWebSearchEngine: jest.fn() }))
jest.mock('../events', () => ({ emitAgentOrchestratorEvent: jest.fn() }))

const responseSchema = z.object({
  answer: z.string().nullable(),
  diagnostics: z.object({ cached: z.boolean(), answerWithheld: z.string().optional() }).passthrough(),
}).passthrough()

function hit(host: string): SearchResult {
  return {
    url: `https://${host}/page`, title: host, snippet: null, content: null,
    publishedAt: null, confidence: 1, sources: [{ adapterId: 'fixture', rank: 1 }],
  }
}

describe('domain policy at agent search and preview boundaries', () => {
  let allowDomains: string[]
  let denyDomains: string[]
  let result: SearchEngineResult
  let context: McpToolContext
  let dispose: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    allowDomains = []
    denyDomains = []
    result = {
      results: [hit('allowed.example'), hit('denied.example')],
      answer: 'UNATTRIBUTED_PROVIDER_ANSWER',
      diagnostics: { adapters: [], degraded: false, cached: false, escalated: false, elapsedMs: 1, pagesRead: 0 },
      byAdapter: [{ adapterId: 'fixture', weight: 1, answer: 'RAW_OPERATOR_COMPARISON', results: [hit('denied.example')] }],
    }
    const container = {
      hasRegistration: () => false,
      resolve(name: string) {
        if (name === 'moduleConfigService') return {
          getRecord: async () => ({ source: 'tenant', value: { guardrails: { allowDomains, denyDomains } } }),
        }
        throw new Error(`[internal] unexpected service: ${name}`)
      },
    } as unknown as AwilixContainer
    context = { container, tenantId: 'tenant-1', organizationId: 'organization-1', userId: 'user-1',
      userFeatures: ['agent_orchestrator.web_search'], isSuperAdmin: false }
    dispose = jest.fn(async () => undefined)
    jest.mocked(buildWebSearchEngine).mockReturnValue({
      engine: { search: jest.fn(async () => result), dispose } as unknown as ReturnType<typeof buildWebSearchEngine>['engine'],
      problems: [],
    })
    jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' })
    jest.mocked(createRequestContainer).mockResolvedValue(container)
  })

  async function invokePreview(): Promise<unknown> {
    const response = await POST(new Request('http://localhost/api/agent_orchestrator/web-search/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'policy' }),
    }))
    expect(response.status).toBe(200)
    return response.json()
  }

  for (const boundary of ['agent', 'preview'] as const) {
    async function invoke() {
      const response = boundary === 'agent'
        ? await webSearchTool.handler({ query: 'policy' }, context)
        : await invokePreview()
      return responseSchema.parse(response)
    }

    it(`${boundary}: withholds an answer when all provider hits are denied`, async () => {
      denyDomains = ['denied.example']
      result = { ...result, results: [hit('denied.example')] }
      const response = await invoke()
      expect(response).toMatchObject({ answer: null, diagnostics: { answerWithheld: 'domain_policy' } })
      expect(response).toHaveProperty(boundary === 'agent' ? 'results' : 'fused', [])
      expect(JSON.stringify(response)).not.toContain('UNATTRIBUTED_PROVIDER_ANSWER')
      expect(dispose).toHaveBeenCalledTimes(1)
    })

    it(`${boundary}: preserves allowed hits while withholding unverified synthesis`, async () => {
      allowDomains = ['allowed.example']
      const response = await invoke()
      expect(response).toMatchObject({ answer: null, diagnostics: { answerWithheld: 'domain_policy' } })
      expect(response).toHaveProperty(boundary === 'agent' ? 'results' : 'fused', [hit('allowed.example')])
      expect(result.answer).toBe('UNATTRIBUTED_PROVIDER_ANSWER')
    })

    it(`${boundary}: withholds even when fusion returns only permitted sources`, async () => {
      denyDomains = ['denied.example']
      result = { ...result, results: [hit('allowed.example')] }
      expect(await invoke()).toMatchObject({ answer: null, diagnostics: { answerWithheld: 'domain_policy' } })
    })

    it(`${boundary}: applies policy to cached output`, async () => {
      allowDomains = ['allowed.example']
      result = { ...result, diagnostics: { ...result.diagnostics, cached: true } }
      expect(await invoke()).toMatchObject({ answer: null, diagnostics: { cached: true, answerWithheld: 'domain_policy' } })
    })

    it(`${boundary}: keeps the provider answer when no domain policy is configured`, async () => {
      const response = await invoke()
      expect(response).toMatchObject({ answer: result.answer })
      expect(response.diagnostics).not.toHaveProperty('answerWithheld')
    })

    it(`${boundary}: reports no withholding when the provider returned no answer`, async () => {
      allowDomains = ['allowed.example']
      result = { ...result, answer: null }
      const response = await invoke()
      expect(response.answer).toBeNull()
      expect(response.diagnostics).not.toHaveProperty('answerWithheld')
    })
  }

  it('retains raw per-adapter data only in the privileged preview comparison', async () => {
    denyDomains = ['denied.example']
    const preview = await invokePreview()
    expect(preview).toMatchObject({ answer: null, byAdapter: [{
      answer: 'RAW_OPERATOR_COMPARISON', results: [{ blockedByGuardrails: true }],
    }] })
    const agent = await webSearchTool.handler({ query: 'policy' }, context)
    expect(agent).not.toHaveProperty('byAdapter')
    expect(JSON.stringify(agent)).not.toContain('RAW_OPERATOR_COMPARISON')
  })
})
