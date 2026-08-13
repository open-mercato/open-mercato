import { buildApiDocsOpenApiDocument, shouldExposeAccessControlMetadata } from '../document'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { Module, ModuleApiRouteFile } from '@open-mercato/shared/modules/registry'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (_key: string, fallback: string) => fallback })),
}))

const getAuthFromRequestMock = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>

const routePath = '/example/records'

function makeModules(): Module[] {
  const api: ModuleApiRouteFile = {
    path: routePath,
    metadata: { GET: { requireAuth: true, requireFeatures: ['example.records.view'] } },
    handlers: { GET: async () => new Response(null) },
    docs: { tag: 'Example', methods: { GET: { responses: [{ status: 200, description: 'Records' }] } } },
  }
  return [{ id: 'example', apis: [api] }]
}

async function buildDocument(includeAccessControlMetadata: boolean) {
  const doc = await buildApiDocsOpenApiDocument({
    modules: makeModules(),
    apiRoutes: [],
    includeAccessControlMetadata,
  })
  return doc.paths[routePath]?.get as Record<string, unknown>
}

describe('shouldExposeAccessControlMetadata', () => {
  beforeEach(() => {
    getAuthFromRequestMock.mockReset()
  })

  it('denies anonymous callers', async () => {
    getAuthFromRequestMock.mockResolvedValue(null)

    await expect(shouldExposeAccessControlMetadata(new Request('http://localhost/api/docs/openapi'))).resolves.toBe(
      false,
    )
  })

  it('allows authenticated callers', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })

    await expect(shouldExposeAccessControlMetadata(new Request('http://localhost/api/docs/openapi'))).resolves.toBe(
      true,
    )
  })

  it('denies the caller when auth resolution throws', async () => {
    getAuthFromRequestMock.mockRejectedValue(new Error('database unavailable'))

    await expect(shouldExposeAccessControlMetadata(new Request('http://localhost/api/docs/openapi'))).resolves.toBe(
      false,
    )
  })
})

describe('buildApiDocsOpenApiDocument', () => {
  it('keeps the ACL identifiers out of the anonymous document', async () => {
    const operation = await buildDocument(false)

    expect(JSON.stringify(operation)).not.toContain('example.records.view')
    expect(operation['x-require-features']).toBeUndefined()
  })

  it('serves the ACL identifiers to authenticated callers', async () => {
    const operation = await buildDocument(true)

    expect(operation.description).toContain('Requires features: example.records.view')
    expect(operation['x-require-features']).toEqual(['example.records.view'])
  })
})
