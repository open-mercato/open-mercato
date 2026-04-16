jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(),
}))

jest.mock('@/.mercato/generated/modules.generated', () => ({
  modules: [],
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    t: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/openapi', () => ({
  buildOpenApiDocument: jest.fn(() => ({
    openapi: '3.1.0',
    info: { title: 'Open Mercato API', version: 'test' },
    paths: { '/api/health': { get: { summary: 'Health' } } },
  })),
  sanitizeOpenApiDocument: jest.fn((doc) => doc),
  generateMarkdownFromOpenApi: jest.fn(() => '# Open Mercato API\n\n## /api/health\n'),
}))

jest.mock('@open-mercato/shared/lib/version', () => ({
  APP_VERSION: 'test',
}))

import { GET } from '../route'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'

const mockedGetAuth = getAuthFromCookies as jest.MockedFunction<typeof getAuthFromCookies>
const mockedBuild = buildOpenApiDocument as jest.MockedFunction<typeof buildOpenApiDocument>

describe('GET /api/docs/markdown (native route)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 401 for anonymous callers (no cookie) and never builds the document', async () => {
    mockedGetAuth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockedBuild).not.toHaveBeenCalled()
  })

  it('returns 200 with markdown for authenticated callers', async () => {
    mockedGetAuth.mockResolvedValue({
      userId: 'u-1',
      tenantId: 't-1',
      organizationId: 'o-1',
    } as never)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('# Open Mercato API')
    expect(mockedBuild).toHaveBeenCalledTimes(1)
  })
})
