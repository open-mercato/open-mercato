import type { McpToolContext } from '../types'
import { getApiEndpoints } from '../api-endpoint-index'
import {
  authorizeCodeModeApiRequest,
  CODE_MODE_REQUIRED_FEATURES,
  matchApiEndpointPath,
} from '../codemode-tools'

jest.mock('../api-endpoint-index', () => ({
  getApiEndpoints: jest.fn(),
  getRawOpenApiSpec: jest.fn(),
}))

const mockedGetApiEndpoints = jest.mocked(getApiEndpoints)

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
        requiredFeatures: ['customers.company.delete'],
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
        requiredFeatures: ['customers.company.delete'],
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
        requiredFeatures: ['customers.company.delete'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    ])

    const result = await authorizeCodeModeApiRequest(
      createContext({ userFeatures: ['ai_assistant.view', 'customers.company.delete'] }),
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
        requiredFeatures: ['customers.company.delete'],
        parameters: [],
        requestBodySchema: null,
        deprecated: false,
      },
    })
  })
})
