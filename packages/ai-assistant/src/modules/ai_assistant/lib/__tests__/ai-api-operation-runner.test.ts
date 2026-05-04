import { z } from 'zod'
import { createAiApiOperationRunner, normalizePath, type AiToolExecutionContext } from '../ai-api-operation-runner'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import {
  TRUSTED_AUTH_CONTEXT_SYMBOL,
  resolveAuthFromRequestDetailed,
  type AuthContext,
} from '@open-mercato/shared/lib/auth/server'
import type { AiToolDefinition, McpToolContext } from '../types'

type CapturedHandlerCall = {
  request: Request
  params: Record<string, string | string[]>
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

function makeCtx(tool: AiToolDefinition): AiToolExecutionContext {
  const baseTool: McpToolContext = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: {} as McpToolContext['container'],
    userFeatures: ['*'],
    isSuperAdmin: true,
  }
  return { ...baseTool, tool }
}

function makeManifestEntry(overrides: Partial<ApiRouteManifestEntry> & {
  path: string
  load: ApiRouteManifestEntry['load']
  methods: ApiRouteManifestEntry['methods']
}): ApiRouteManifestEntry {
  return {
    moduleId: 'test',
    kind: 'route-file',
    ...overrides,
  }
}

describe('createAiApiOperationRunner', () => {
  let fetchSpy: jest.SpyInstance | null = null

  beforeEach(() => {
    if (typeof globalThis.fetch === 'function') {
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('fetch must not be called by the in-process runner')
      })
    } else {
      const mock = jest.fn(() => {
        throw new Error('fetch must not be called by the in-process runner')
      })
      ;(globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch
      fetchSpy = mock as unknown as jest.SpyInstance
    }
  })

  afterEach(() => {
    fetchSpy?.mockRestore?.()
    fetchSpy = null
  })

  it('resolves a documented GET route and invokes it in-process with parsed query', async () => {
    const captured: CapturedHandlerCall[] = []
    const handler = jest.fn(async (req: Request, ctx?: { params: Record<string, string | string[]> }) => {
      captured.push({ request: req, params: ctx?.params ?? {} })
      return new Response(JSON.stringify({ items: [{ id: 'p1' }], total: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          openApi: { tag: 'Customers', methods: { GET: {} } },
          metadata: { GET: { requireAuth: true, requireFeatures: ['customers.people.view'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({
      method: 'GET',
      path: '/customers/people',
      query: { search: 'taylor', page: 1 },
    })

    expect(result).toEqual({
      success: true,
      statusCode: 200,
      data: { items: [{ id: 'p1' }], total: 1 },
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].request.method).toBe('GET')
    const url = new URL(captured[0].request.url)
    expect(url.pathname).toBe('/api/customers/people')
    expect(url.searchParams.get('search')).toBe('taylor')
    expect(url.searchParams.get('page')).toBe('1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects undocumented endpoints (route module without openApi export)', async () => {
    const handler = jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/internal/secret',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          metadata: { GET: { requireAuth: true, requireFeatures: ['internal.view'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'internal.list', requiredFeatures: ['internal.view'] })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'GET', path: '/internal/secret' })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(501)
    expect(result.error).toMatch(/undocumented/i)
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects when the manifest entry does not declare the requested method', async () => {
    const handler = jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          openApi: { tag: 'Customers', methods: { GET: {} } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.create_person', requiredFeatures: ['customers.people.manage'] })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'POST', path: '/customers/people', body: { name: 'Taylor' } })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(404)
  })

  it('rejects mutation routes that declare no requiredFeatures unless allowFeaturelessMutation is set', async () => {
    const handler = jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/loose',
        methods: ['POST'],
        load: async () => ({
          POST: handler,
          openApi: { tag: 'Customers', methods: { POST: {} } },
          metadata: { POST: { requireAuth: true } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.loose_write', requiredFeatures: ['customers.people.manage'], isMutation: true })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const denied = await runner.run({ method: 'POST', path: '/customers/loose', body: {} })
    expect(denied.success).toBe(false)
    expect(denied.statusCode).toBe(403)
    expect(denied.error).toMatch(/requiredFeatures/i)
    expect(handler).not.toHaveBeenCalled()

    const allowed = await runner.run({
      method: 'POST',
      path: '/customers/loose',
      body: {},
      allowFeaturelessMutation: true,
    })
    expect(allowed.success).toBe(true)
    expect(allowed.statusCode).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('rejects when the tool requiredFeatures do not cover the route requiredFeatures', async () => {
    const handler = jest.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          openApi: { tag: 'Customers', methods: { GET: {} } },
          metadata: { GET: { requireAuth: true, requireFeatures: ['customers.people.view'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.weak_tool', requiredFeatures: ['catalog.products.view'] })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'GET', path: '/customers/people' })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(403)
    expect(result.error).toMatch(/do not cover/i)
    expect(handler).not.toHaveBeenCalled()
  })

  it('propagates the AI tool auth context onto the synthetic Request and the shared resolver short-circuits to it', async () => {
    let resolved: AuthContext = null
    const handler = jest.fn(async (req: Request) => {
      resolved = (await resolveAuthFromRequestDetailed(req)).auth
      const carrier = req as unknown as Record<symbol, unknown>
      const envelope = carrier[TRUSTED_AUTH_CONTEXT_SYMBOL]
      expect(envelope).toBeTruthy()
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['GET'],
        load: async () => ({
          GET: handler,
          openApi: { tag: 'Customers', methods: { GET: {} } },
          metadata: { GET: { requireAuth: true, requireFeatures: ['customers.people.view'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.list_people', requiredFeatures: ['customers.people.view'] })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'GET', path: '/customers/people' })

    expect(result.success).toBe(true)
    expect(resolved).not.toBeNull()
    expect(resolved?.tenantId).toBe('tenant-1')
    expect(resolved?.orgId).toBe('org-1')
    expect(resolved?.userId).toBe('user-1')
    expect(resolved?.sub).toBe('user-1')
    expect(resolved?.isSuperAdmin).toBe(true)
  })

  it('normalizes a 4xx JSON error response into { success: false, statusCode, error, details }', async () => {
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['POST'],
        load: async () => ({
          POST: async () => new Response(
            JSON.stringify({ error: 'Validation failed', fieldErrors: { name: ['required'] } }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          ),
          openApi: { tag: 'Customers', methods: { POST: {} } },
          metadata: { POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.create_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'POST', path: '/customers/people', body: { name: '' } })

    expect(result).toEqual({
      success: false,
      statusCode: 422,
      error: 'Validation failed',
      details: { fieldErrors: { name: ['required'] } },
    })
  })

  it('normalizes a 2xx JSON response into { success: true, statusCode, data }', async () => {
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/customers/people',
        methods: ['POST'],
        load: async () => ({
          POST: async () => new Response(
            JSON.stringify({ id: 'p1', personId: 'p1' }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
          openApi: { tag: 'Customers', methods: { POST: {} } },
          metadata: { POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'customers.create_person', requiredFeatures: ['customers.people.manage'], isMutation: true })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'POST', path: '/customers/people', body: { name: 'Taylor' } })

    expect(result).toEqual({
      success: true,
      statusCode: 201,
      data: { id: 'p1', personId: 'p1' },
    })
  })

  it('routes dynamic path segments into the handler params', async () => {
    let captured: { request: Request; params: Record<string, string | string[]> } | null = null
    const handler = jest.fn(async (req: Request, ctx?: { params: Record<string, string | string[]> }) => {
      captured = { request: req, params: ctx?.params ?? {} }
      return new Response(
        JSON.stringify({ id: ctx?.params?.itemId ?? null }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        path: '/dashboards/layout/[itemId]',
        methods: ['PATCH'],
        load: async () => ({
          PATCH: handler,
          openApi: { tag: 'Dashboards', methods: { PATCH: {} } },
          metadata: { PATCH: { requireAuth: true, requireFeatures: ['dashboards.manage'] } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'dashboards.update_layout_item', requiredFeatures: ['dashboards.manage'], isMutation: true })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({
      method: 'PATCH',
      path: '/dashboards/layout/abc-123',
      body: { x: 0, y: 0 },
    })

    expect(result).toEqual({ success: true, statusCode: 200, data: { id: 'abc-123' } })
    expect(captured).not.toBeNull()
    expect(captured!.params.itemId).toBe('abc-123')
  })

  it('falls back to default export for legacy route entries', async () => {
    const legacyHandler = jest.fn(async () => new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const apiRoutes: ApiRouteManifestEntry[] = [
      makeManifestEntry({
        moduleId: 'directory',
        kind: 'legacy',
        method: 'GET',
        path: '/directory/organizations/lookup',
        methods: ['GET'],
        load: async () => ({
          default: legacyHandler,
          openApi: { tag: 'Directory', methods: { GET: {} } },
          metadata: { GET: { requireAuth: false } },
        }),
      }),
    ]

    const tool = makeTool({ name: 'directory.lookup_org' })
    const runner = createAiApiOperationRunner(makeCtx(tool), { apiRoutes })

    const result = await runner.run({ method: 'GET', path: '/directory/organizations/lookup', query: { slug: 'acme' } })

    expect(result.success).toBe(true)
    expect(legacyHandler).toHaveBeenCalledTimes(1)
  })
})

describe('normalizePath (CodeQL js/polynomial-redos regression)', () => {
  it('returns "/" for empty / non-string input', () => {
    expect(normalizePath('')).toBe('/')
    // Defensive: the type system says string-only, but agent inputs are JSON.
    expect(normalizePath(undefined as unknown as string)).toBe('/')
    expect(normalizePath(null as unknown as string)).toBe('/')
  })

  it('preserves a path that already starts with "/" and has no trailing slash', () => {
    expect(normalizePath('/api/customers/people')).toBe('/api/customers/people')
  })

  it('prepends "/" when the input does not start with one', () => {
    expect(normalizePath('api/foo')).toBe('/api/foo')
  })

  it('strips a single trailing slash', () => {
    expect(normalizePath('/api/foo/')).toBe('/api/foo')
  })

  it('strips multiple trailing slashes', () => {
    expect(normalizePath('/api/foo///')).toBe('/api/foo')
    expect(normalizePath('/a/b/c////')).toBe('/a/b/c')
  })

  it('returns "/" for the all-slashes edge case (matches the previous regex behavior)', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('//')).toBe('/')
    expect(normalizePath('////')).toBe('/')
  })

  it('runs in linear time on long runs of trailing slashes (no polynomial backtracking)', () => {
    // The previous implementation `trimmed.replace(/\/+$/, '')` was flagged by
    // CodeQL js/polynomial-redos. A 1M-character all-slash input must complete
    // in a small bounded budget — anything in the multi-second range would
    // indicate the regex regression has crept back in.
    const huge = '/'.repeat(1_000_000)
    const start = Date.now()
    const out = normalizePath(huge)
    const elapsed = Date.now() - start
    expect(out).toBe('/')
    // 200ms is generous; the linear scan typically finishes in <20ms.
    expect(elapsed).toBeLessThan(200)
  })

  it('only strips trailing slashes — never internal ones', () => {
    expect(normalizePath('/api//customers//people')).toBe('/api//customers//people')
    expect(normalizePath('/api//customers//people///')).toBe('/api//customers//people')
  })
})
