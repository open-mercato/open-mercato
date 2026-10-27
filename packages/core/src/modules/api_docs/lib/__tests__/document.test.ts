import {
  buildApiDocsOpenApiDocument,
  resolveForwardableCookieHeader,
  shouldExposeAccessControlMetadata,
} from '../document'
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

describe('resolveForwardableCookieHeader', () => {
  function requestHeaders(entries: Record<string, string>): Pick<Headers, 'get'> {
    return { get: (name: string) => entries[name.toLowerCase()] ?? null }
  }

  it('forwards the session cookie to an export route on the serving origin', () => {
    const forwarded = resolveForwardableCookieHeader(
      'https://shop.example.com/api',
      requestHeaders({ cookie: 'auth_token=abc', host: 'shop.example.com', 'x-forwarded-proto': 'https' }),
    )

    expect(forwarded).toBe('auth_token=abc')
  })

  it('withholds the session cookie when the docs base URL points at another origin', () => {
    const forwarded = resolveForwardableCookieHeader(
      'https://external.example.net/api',
      requestHeaders({ cookie: 'auth_token=abc', host: 'shop.example.com', 'x-forwarded-proto': 'https' }),
    )

    expect(forwarded).toBeNull()
  })

  it('withholds the session cookie when the docs base URL downgrades the serving protocol', () => {
    const forwarded = resolveForwardableCookieHeader(
      'http://shop.example.com/api',
      requestHeaders({ cookie: 'auth_token=abc', host: 'shop.example.com', 'x-forwarded-proto': 'https' }),
    )

    expect(forwarded).toBeNull()
  })

  it('returns null when the visitor sends no cookies', () => {
    expect(
      resolveForwardableCookieHeader('https://shop.example.com/api', requestHeaders({ host: 'shop.example.com' })),
    ).toBeNull()
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
