import type { McpToolContext } from '../types'
import { getApiEndpoints } from '../api-endpoint-index'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import {
  authorizeCodeModeApiRequest,
  CODE_MODE_MAX_API_CALLS,
  CODE_MODE_MAX_MUTATION_CALLS,
  CODE_MODE_REQUIRED_FEATURES,
  createApiRequestFn,
  isUnsafeApiRequestPath,
  isUnsafeHttpMethod,
  matchApiEndpointPath,
} from '../codemode-tools'

jest.mock('../api-endpoint-index', () => ({
  getApiEndpoints: jest.fn(),
  getRawOpenApiSpec: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/http/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
  resolveTimeoutMs: jest.fn(() => 30000),
}))

const mockedGetApiEndpoints = jest.mocked(getApiEndpoints)
const mockedFetchWithTimeout = jest.mocked(fetchWithTimeout)

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue('{}'),
  } as unknown as Response
}

/**
 * Replicate the execute() handler's per-run counters so the regression test
 * exercises the same accounting that gates real api.request() calls.
 */
function createCountingOnCall() {
  let apiCallCount = 0
  let mutationCallCount = 0
  const onCall = (normalizedMethod: string) => {
    apiCallCount++
    if (apiCallCount > CODE_MODE_MAX_API_CALLS) {
      throw new Error(`API call limit exceeded (max ${CODE_MODE_MAX_API_CALLS})`)
    }
    if (isUnsafeHttpMethod(normalizedMethod)) {
      mutationCallCount++
      if (mutationCallCount > CODE_MODE_MAX_MUTATION_CALLS) {
        throw new Error(`Mutation API call limit exceeded (max ${CODE_MODE_MAX_MUTATION_CALLS})`)
      }
    }
  }
  return {
    onCall,
    counts: () => ({ apiCallCount, mutationCallCount }),
  }
}

type MockRbacService = {
  hasAllFeatures: jest.Mock<boolean, [string[], string[]]>
}

function createContext(
  overrides: Partial<McpToolContext> = {},
  rbacService?: MockRbacService
): McpToolContext {
  const defaultRbacService: MockRbacService = rbacService ?? {
    hasAllFeatures: jest.fn((requiredFeatures: string[], userFeatures: string[]) =>
      requiredFeatures.every((feature) => userFeatures.includes(feature))
    ),
  }

  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    apiKeySecret: 'omk_test.secret',
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'rbacService') {
          return defaultRbacService
        }
        throw new Error(`Unknown dependency: ${name}`)
      }),
    } as unknown as McpToolContext['container'],
    ...overrides,
  }
}

describe('CODE_MODE_REQUIRED_FEATURES', () => {
  it('requires ai_assistant.view for Code Mode tools', () => {
    expect(CODE_MODE_REQUIRED_FEATURES).toEqual(['ai_assistant.view'])
  })
})

describe('matchApiEndpointPath', () => {
  it('matches OpenAPI path params against concrete request paths', () => {
    expect(
      matchApiEndpointPath('/api/customers/companies/{id}', '/api/customers/companies/company-1')
    ).toBe(true)
  })

  it('normalizes missing /api prefixes and query strings', () => {
    expect(
      matchApiEndpointPath('/api/customers/companies/{id}', 'customers/companies/company-1?expand=1')
    ).toBe(true)
  })

  it('rejects different resource paths', () => {
    expect(
      matchApiEndpointPath('/api/customers/companies/{id}', '/api/customers/people/person-1')
    ).toBe(false)
  })
})

describe('authorizeCodeModeApiRequest', () => {
  beforeEach(() => {
    mockedGetApiEndpoints.mockReset()
  })

  it('denies undocumented endpoints', async () => {
    mockedGetApiEndpoints.mockResolvedValue([])

    const result = await authorizeCodeModeApiRequest(
      createContext(),
      'DELETE',
      '/api/customers/companies'
    )

    expect(result).toEqual({
      allowed: false,
      statusCode: 403,
      error: 'Code Mode cannot call undocumented API endpoint DELETE /api/customers/companies',
    })
  })

  it('denies access when endpoint features are missing', async () => {
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'delete_companies',
        operationId: 'delete_companies',
        method: 'DELETE',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: ['customers.companies.delete'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(
      createContext({ userFeatures: ['ai_assistant.view'] }),
      'DELETE',
      '/api/customers/companies'
    )

    expect(result).toEqual({
      allowed: false,
      statusCode: 403,
      error: 'Insufficient permissions for DELETE /api/customers/companies',
      details: {
        requiredFeatures: ['customers.companies.delete'],
        operationId: 'delete_companies',
      },
    })
  })

  it('denies mutation endpoints that do not declare required features', async () => {
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'accept_quote',
        operationId: 'accept_quote',
        method: 'POST',
        path: '/api/sales/quotes/accept',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: [],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(
      createContext(),
      'POST',
      '/api/sales/quotes/accept'
    )

    expect(result).toEqual({
      allowed: false,
      statusCode: 403,
      error: 'Code Mode cannot call mutation endpoint without declared required features: POST /api/sales/quotes/accept',
      details: {
        operationId: 'accept_quote',
      },
    })
  })

  it('allows documented reads without endpoint features', async () => {
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'list_companies',
        operationId: 'list_companies',
        method: 'GET',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: [],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(
      createContext(),
      'GET',
      '/api/customers/companies'
    )

    expect(result).toEqual({
      allowed: true,
      endpoint: {
        id: 'list_companies',
        operationId: 'list_companies',
        method: 'GET',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: [],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    })
  })

  it('allows endpoint calls when user has the required feature', async () => {
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'delete_company',
        operationId: 'delete_company',
        method: 'DELETE',
        path: '/api/customers/companies/{id}',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: ['customers.companies.delete'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(
      createContext({ userFeatures: ['ai_assistant.view', 'customers.companies.delete'] }),
      'DELETE',
      '/api/customers/companies/company-1'
    )

    expect(result).toEqual({
      allowed: true,
      endpoint: {
        id: 'delete_company',
        operationId: 'delete_company',
        method: 'DELETE',
        path: '/api/customers/companies/{id}',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: ['customers.companies.delete'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    })
  })
})

describe('path traversal hardening (issue #2667)', () => {
  describe('isUnsafeApiRequestPath', () => {
    it.each([
      '/api/foo/../admin',
      '/api/foo/..',
      '/api/foo/./admin',
      '/api/.',
      '/api/foo/%2e%2e/admin',
      '/api/foo/%2E%2E/admin',
      '/api/foo/%2e./admin',
      '/api/foo/.%2e/admin',
      '/api/foo/%2e/admin',
      '/api/foo\\admin',
      '/api/foo%2fadmin',
      '/api/foo%2Fadmin',
      '/api/foo%5cadmin',
      'foo/../admin',
      '/api/foo/../admin?expand=1',
      // Raw ASCII tab/newline/CR are stripped by the WHATWG URL parser before
      // the fetch, so `.<ctrl>.` collapses to `..` on the wire.
      '/api/foo/.\t./admin',
      '/api/foo/.\n./admin',
      '/api/foo/.\r./admin',
      '/api/foo/\t../admin',
    ])('flags %s as unsafe', (path) => {
      expect(isUnsafeApiRequestPath(path)).toBe(true)
    })

    it.each([
      '/api/customers/companies',
      '/api/customers/companies/company-1',
      'customers/companies/company-1?expand=1',
      '/api/catalog/products/1.2.3',
      '/api/customers/companies/00000000-0000-0000-0000-000000000000',
    ])('treats %s as safe', (path) => {
      expect(isUnsafeApiRequestPath(path)).toBe(false)
    })
  })

  it('denies a traversal path even when a parameterized endpoint would match', async () => {
    mockedGetApiEndpoints.mockReset()
    // A documented read the user is authorized for. The un-normalized segment
    // matcher would have accepted '/api/foo/..' against '/api/foo/{id}', then
    // the wire fetch would collapse it to '/api/admin'. The guard blocks it.
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'get_foo',
        operationId: 'get_foo',
        method: 'GET',
        path: '/api/foo/{id}',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: [],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(createContext(), 'GET', '/api/foo/..')

    expect(result).toEqual({
      allowed: false,
      statusCode: 403,
      error: 'Code Mode rejected unsafe API path: GET /api/foo/..',
    })
  })

  it('never issues the wire request for a traversal path', async () => {
    mockedGetApiEndpoints.mockReset()
    mockedFetchWithTimeout.mockReset()
    mockedFetchWithTimeout.mockResolvedValue(okResponse())
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'create_company',
        operationId: 'create_company',
        method: 'POST',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: ['customers.companies.create'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const apiRequest = createApiRequestFn(
      createContext({ userFeatures: ['ai_assistant.view', 'customers.companies.create'] }),
      () => {}
    )

    const result = (await apiRequest({
      method: 'POST',
      path: '/api/customers/companies/../admin',
      body: {},
    })) as { success: boolean; statusCode: number }

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(403)
    expect(mockedFetchWithTimeout).not.toHaveBeenCalled()
  })
})

describe('mutation call cap (issue #2724)', () => {
  beforeEach(() => {
    mockedGetApiEndpoints.mockReset()
    mockedFetchWithTimeout.mockReset()
    mockedFetchWithTimeout.mockResolvedValue(okResponse())
    // Documented, feature-authorized POST endpoint so RBAC always allows the call.
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'create_company',
        operationId: 'create_company',
        method: 'POST',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: ['customers.companies.create'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])
  })

  function authorizedContext(): McpToolContext {
    return createContext({
      userFeatures: ['ai_assistant.view', 'customers.companies.create'],
    })
  }

  it('counts a dynamically-built POST method against the mutation cap', async () => {
    const { onCall, counts } = createCountingOnCall()
    const apiRequest = createApiRequestFn(authorizedContext(), onCall)

    // The method string is built at runtime — the old static regex never saw it.
    const dynamicMethod = 'PO' + 'ST'
    await apiRequest({ method: dynamicMethod, path: '/api/customers/companies', body: {} })

    expect(counts()).toEqual({ apiCallCount: 1, mutationCallCount: 1 })
  })

  it('refuses once the dynamically-built mutation cap is exceeded', async () => {
    const { onCall } = createCountingOnCall()
    const apiRequest = createApiRequestFn(authorizedContext(), onCall)

    const dynamicMethod = ['P', 'O', 'S', 'T'].join('')
    for (let index = 0; index < CODE_MODE_MAX_MUTATION_CALLS; index++) {
      await apiRequest({ method: dynamicMethod, path: '/api/customers/companies', body: {} })
    }

    await expect(
      apiRequest({ method: dynamicMethod, path: '/api/customers/companies', body: {} })
    ).rejects.toThrow(`Mutation API call limit exceeded (max ${CODE_MODE_MAX_MUTATION_CALLS})`)

    // Authorized mutations actually hit fetch up to the cap; the cap throws before fetch on the overflow call.
    expect(mockedFetchWithTimeout).toHaveBeenCalledTimes(CODE_MODE_MAX_MUTATION_CALLS)
  })

  it('does not charge GET reads against the mutation cap', async () => {
    mockedGetApiEndpoints.mockResolvedValue([
      {
        id: 'list_companies',
        operationId: 'list_companies',
        method: 'GET',
        path: '/api/customers/companies',
        summary: '',
        description: '',
        tags: [],
        requiredFeatures: [],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])
    const { onCall, counts } = createCountingOnCall()
    const apiRequest = createApiRequestFn(createContext(), onCall)

    for (let index = 0; index < CODE_MODE_MAX_MUTATION_CALLS + 5; index++) {
      await apiRequest({ method: 'get', path: '/api/customers/companies' })
    }

    expect(counts()).toEqual({ apiCallCount: CODE_MODE_MAX_MUTATION_CALLS + 5, mutationCallCount: 0 })
  })
})

describe('scope enforcement (issue #2658)', () => {
  const listCompaniesEndpoint = {
    id: 'list_companies',
    operationId: 'list_companies',
    method: 'GET',
    path: '/api/customers/companies',
    summary: '',
    description: '',
    tags: [],
    requiredFeatures: [],
    parameters: [],
    requestBodySchema: null,
    deprecated: false,
  }
  const createCompanyEndpoint = {
    id: 'create_company',
    operationId: 'create_company',
    method: 'POST',
    path: '/api/customers/companies',
    summary: '',
    description: '',
    tags: [],
    requiredFeatures: ['customers.companies.create'],
    parameters: [],
    requestBodySchema: null,
    deprecated: false,
  }

  beforeEach(() => {
    mockedGetApiEndpoints.mockReset()
    mockedFetchWithTimeout.mockReset()
    mockedFetchWithTimeout.mockResolvedValue(okResponse())
  })

  function fetchedUrl(): URL {
    const [url] = mockedFetchWithTimeout.mock.calls[0]
    return new URL(url as string)
  }
  function fetchedBody(): Record<string, unknown> {
    const [, init] = mockedFetchWithTimeout.mock.calls[0]
    return JSON.parse((init as { body: string }).body)
  }
  function creatorContext(scope: Partial<McpToolContext> = {}): McpToolContext {
    return createContext({
      userFeatures: ['ai_assistant.view', 'customers.companies.create'],
      ...scope,
    })
  }

  it('drops AI-supplied query scope when ctx scope is null (fail closed)', async () => {
    mockedGetApiEndpoints.mockResolvedValue([listCompaniesEndpoint])
    const apiRequest = createApiRequestFn(
      createContext({ tenantId: null, organizationId: null }),
      () => {}
    )

    await apiRequest({
      method: 'GET',
      path: '/api/customers/companies',
      query: { tenantId: 'evil', organizationId: 'evil-org', city: 'NYC' },
    })

    const params = fetchedUrl().searchParams
    expect(params.get('tenantId')).toBeNull()
    expect(params.get('organizationId')).toBeNull()
    expect(params.get('city')).toBe('NYC')
  })

  it('overrides AI-supplied query scope with ctx scope', async () => {
    mockedGetApiEndpoints.mockResolvedValue([listCompaniesEndpoint])
    const apiRequest = createApiRequestFn(createContext(), () => {})

    await apiRequest({
      method: 'GET',
      path: '/api/customers/companies',
      query: { tenantId: 'evil' },
    })

    expect(fetchedUrl().searchParams.get('tenantId')).toBe('tenant-1')
  })

  it('strips AI-supplied body scope when ctx scope is null', async () => {
    mockedGetApiEndpoints.mockResolvedValue([createCompanyEndpoint])
    const apiRequest = createApiRequestFn(
      creatorContext({ tenantId: null, organizationId: null }),
      () => {}
    )

    await apiRequest({
      method: 'POST',
      path: '/api/customers/companies',
      body: { name: 'Acme', tenantId: 'evil', organizationId: 'evil-org' },
    })

    const body = fetchedBody()
    expect(body.name).toBe('Acme')
    expect('tenantId' in body).toBe(false)
    expect('organizationId' in body).toBe(false)
  })

  it('overrides AI-supplied body scope with ctx scope', async () => {
    mockedGetApiEndpoints.mockResolvedValue([createCompanyEndpoint])
    const apiRequest = createApiRequestFn(creatorContext(), () => {})

    await apiRequest({
      method: 'POST',
      path: '/api/customers/companies',
      body: { name: 'Acme', tenantId: 'evil' },
    })

    const body = fetchedBody()
    expect(body.tenantId).toBe('tenant-1')
    expect(body.organizationId).toBe('org-1')
  })

  it('enforces query scope on non-GET methods too (not only GET)', async () => {
    mockedGetApiEndpoints.mockResolvedValue([createCompanyEndpoint])
    const apiRequest = createApiRequestFn(creatorContext(), () => {})

    await apiRequest({
      method: 'POST',
      path: '/api/customers/companies',
      query: { tenantId: 'evil' },
      body: {},
    })

    expect(fetchedUrl().searchParams.get('tenantId')).toBe('tenant-1')
  })

  it('drops dangerous prototype-pollution keys from the body', async () => {
    mockedGetApiEndpoints.mockResolvedValue([createCompanyEndpoint])
    const apiRequest = createApiRequestFn(creatorContext(), () => {})

    await apiRequest({
      method: 'POST',
      path: '/api/customers/companies',
      body: { name: 'Acme', ['__proto__']: { polluted: true } } as Record<string, unknown>,
    })

    const body = fetchedBody()
    expect(body.name).toBe('Acme')
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
