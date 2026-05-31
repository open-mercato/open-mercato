import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

const getAuthFromRequestMock = jest.fn()
const userHasAllFeaturesMock = jest.fn<
  ReturnType<RbacService['userHasAllFeatures']>,
  Parameters<RbacService['userHasAllFeatures']>
>()

jest.mock('@/.mercato/generated/modules.generated', () => ({
  modules: [],
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
      return null
    },
  }),
}))

jest.mock('@open-mercato/core/modules/api_docs/lib/resources', () => ({
  resolveApiDocsBaseUrl: () => 'https://example.test',
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('@open-mercato/shared/lib/openapi', () => ({
  buildOpenApiDocument: jest.fn(() => ({ openapi: '3.1.0' })),
  sanitizeOpenApiDocument: jest.fn((doc) => doc),
  generateMarkdownFromOpenApi: jest.fn(() => '# API Docs'),
}))

import { GET as getOpenApi } from '@/app/api/docs/openapi/route'
import { GET as getMarkdown } from '@/app/api/docs/markdown/route'

describe('API docs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userHasAllFeaturesMock.mockResolvedValue(true)
  })

  it('returns 401 for anonymous OpenAPI requests', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce(null)

    const response = await getOpenApi(new Request('https://example.test/api/docs/openapi'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Authentication required' })
  })

  it('returns 403 when authenticated user lacks api_docs.view', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isSuperAdmin: false,
    })
    userHasAllFeaturesMock.mockResolvedValueOnce(false)

    const response = await getOpenApi(new Request('https://example.test/api/docs/openapi'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Insufficient permissions' })
  })

  it('returns markdown for authorized users', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      isSuperAdmin: false,
    })

    const response = await getMarkdown(new Request('https://example.test/api/docs/markdown'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    await expect(response.text()).resolves.toBe('# API Docs')
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith('user-1', ['api_docs.view'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
