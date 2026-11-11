import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { CONTRACT_VERSION, READY, type AdapterModule } from '@open-mercato/web-research'
import { webFetchTool, webSearchTool } from '../tools'

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: jest.fn(),
}))

jest.mock('../../../events', () => ({ emitAgentOrchestratorEvent: jest.fn() }))

describe('agent web content redirect policy across registry, engine and tools', () => {
  let server: Server
  let allowedOrigin: string
  let internalOrigin: string
  let resultUrl: string
  let context: McpToolContext
  let requests: string[]
  let denyDomains: string[]
  let allowDomains: string[]
  let previousPrivateHosts: string | undefined
  let cacheGet: jest.Mock
  let cacheSet: jest.Mock

  beforeEach(async () => {
    previousPrivateHosts = process.env.OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS
    process.env.OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS = 'allowed.example,search.internal.local'
    requests = []
    denyDomains = ['search.internal.local']
    allowDomains = []
    cacheGet = jest.fn(async () => null)
    cacheSet = jest.fn(async () => {})
    server = createServer((request, response) => {
      requests.push(`${request.headers.host}${request.url}`)
      if (request.url === '/search') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ url: resultUrl }))
      } else if (request.url === '/redirect') {
        response.writeHead(302, { location: `${internalOrigin}/admin` })
        response.end()
      } else if (request.url === '/permitted-redirect') {
        response.writeHead(302, { location: '/page' })
        response.end()
      } else {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end(request.url === '/admin' ? 'DENIED_PAGE_MARKER' : 'Permitted page content')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    allowedOrigin = `http://allowed.example:${port}`
    internalOrigin = `http://search.internal.local:${port}`
    resultUrl = `${allowedOrigin}/redirect`

    const adapter: AdapterModule = {
      id: 'local-search',
      kind: 'api',
      contractVersion: CONTRACT_VERSION,
      optionsSchema: z.object({}),
      createAdapter: () => ({
        id: 'local-search',
        kind: 'api',
        capabilities: {
          search: true,
          fetch: false,
          snippets: true,
          content: false,
          freshness: false,
          siteFilter: false,
          cost: 'free',
        },
        readiness: () => READY,
        async search(_request, adapterContext) {
          const response = await adapterContext.http.request(`${internalOrigin}/search`)
          const hit = z.object({ url: z.url() }).parse(JSON.parse(response.body))
          return { status: 'ok', results: [{ url: hit.url, title: 'Search result', snippet: 'Snippet' }] }
        },
      }),
    }
    const container = {
      hasRegistration: () => false,
      resolve(name: string) {
        if (name === 'webResearchAdapterEntries') return [{ packageName: 'local-search', module: adapter }]
        if (name === 'cache') return { get: cacheGet, set: cacheSet }
        if (name === 'moduleConfigService') {
          return {
            getRecord: async () => ({
              source: 'tenant',
              value: {
                adapters: [{ id: 'local-search', enabled: true, order: 0, weight: 1 }],
                lastResort: null,
                minResults: 1,
                guardrails: { denyDomains, allowDomains },
              },
            }),
          }
        }
        throw new Error(`[internal] unexpected service: ${name}`)
      },
    } as unknown as AwilixContainer
    context = { container, tenantId: 'tenant-1', organizationId: 'organization-1' } as McpToolContext
  })

  afterEach(async () => {
    if (previousPrivateHosts === undefined) delete process.env.OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS
    else process.env.OM_WEB_SEARCH_ALLOW_PRIVATE_HOSTS = previousPrivateHosts
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('keeps the internal adapter reachable while refusing redirected agent egress and page text', async () => {
    const result = await webSearchTool.handler({ query: 'policy', includeContent: true }, context)

    expect(result).toMatchObject({ ok: true, results: [{ url: resultUrl, content: null }] })
    expect(JSON.stringify(result)).not.toContain('DENIED_PAGE_MARKER')
    expect(requests).toEqual([
      `${new URL(internalOrigin).host}/search`,
      `${new URL(allowedOrigin).host}/redirect`,
    ])
  })

  it('never fetches a denied original search hit', async () => {
    resultUrl = `${internalOrigin}/admin`

    const result = await webSearchTool.handler({ query: 'policy', includeContent: true }, context)

    expect(result).toMatchObject({ ok: true, results: [] })
    expect(requests).toEqual([`${new URL(internalOrigin).host}/search`])
  })

  it('returns permitted redirected content under the final URL', async () => {
    resultUrl = `${allowedOrigin}/permitted-redirect`

    const result = await webSearchTool.handler({ query: 'policy', includeContent: true }, context)

    expect(result).toMatchObject({
      ok: true,
      results: [{ url: `${allowedOrigin}/page`, content: 'Permitted page content' }],
    })
    expect(requests).toHaveLength(3)
  })

  it('applies an exclusive allowlist to redirect destinations without blocking the adapter', async () => {
    denyDomains = []
    allowDomains = ['allowed.example']

    const result = await webSearchTool.handler({ query: 'policy', includeContent: true }, context)

    expect(result).toMatchObject({ ok: true, results: [{ content: null }] })
    expect(requests).toHaveLength(2)
    expect(requests.some((request) => request.endsWith('/admin'))).toBe(false)
  })

  it('applies the same before-egress policy to direct web_fetch redirects', async () => {
    const result = await webFetchTool.handler({ url: resultUrl }, context)

    expect(result).toMatchObject({ ok: false, code: 'domain_blocked' })
    expect(requests).toEqual([`${new URL(allowedOrigin).host}/redirect`])
  })

  it('ignores cached enriched content from before domain restrictions were configured', async () => {
    cacheGet.mockResolvedValue({
      results: [{ url: resultUrl, content: 'DENIED_PAGE_MARKER' }],
      answer: null,
      diagnostics: { adapters: [], degraded: false, cached: false, escalated: false, elapsedMs: 0, pagesRead: 1 },
    })

    const result = await webSearchTool.handler({ query: 'policy', includeContent: true }, context)

    expect(JSON.stringify(result)).not.toContain('DENIED_PAGE_MARKER')
    expect(cacheGet).not.toHaveBeenCalled()
    expect(cacheSet).not.toHaveBeenCalled()
    expect(requests).toHaveLength(2)
  })
})
