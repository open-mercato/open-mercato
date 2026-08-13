import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { Module, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'

const routePath = '/example/records'

const exampleApi: ModuleApiRouteFile = {
  path: routePath,
  metadata: { GET: { requireAuth: true, requireFeatures: ['example.records.view'] } },
  handlers: { GET: async () => new Response(null) },
  docs: { tag: 'Example', methods: { GET: { responses: [{ status: 200, description: 'Records' }] } } },
}

const exampleModules: Module[] = [{ id: 'example', apis: [exampleApi] }]

jest.mock('@/.mercato/generated/modules.runtime.generated', () => ({ modules: exampleModules }), { virtual: true })
jest.mock('@/.mercato/generated/api-routes.generated', () => ({ apiRoutes: [] }), { virtual: true })
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback: string) => fallback })),
}))

const getAuthFromRequestMock = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>

function request(): Request {
  return new Request('http://localhost:3000/api/docs/openapi')
}

describe('public API docs export routes', () => {
  beforeEach(() => {
    getAuthFromRequestMock.mockReset()
  })

  it('serves the OpenAPI document to anonymous callers without ACL identifiers', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)
    const { GET } = await import('../openapi/route')

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.paths[routePath].get).toBeDefined()
    expect(JSON.stringify(body)).not.toContain('example.records.view')
  })

  it('serves the ACL identifiers in the OpenAPI document to authenticated callers', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    const { GET } = await import('../openapi/route')

    const body = await (await GET(request())).json()

    expect(body.paths[routePath].get['x-require-features']).toEqual(['example.records.view'])
  })

  it('keeps the ACL identifiers out of the anonymous markdown export', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)
    const { GET } = await import('../markdown/route')

    const response = await GET(request())
    const markdown = await response.text()

    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(markdown).toContain(routePath)
    expect(markdown).not.toContain('example.records.view')
  })

  it('serves the ACL identifiers in the markdown export to authenticated callers', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    const { GET } = await import('../markdown/route')

    const markdown = await (await GET(request())).text()

    expect(markdown).toContain('example.records.view')
  })
})
