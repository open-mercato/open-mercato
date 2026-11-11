import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getApiEndpoints, type ApiEndpoint } from '../api-endpoint-index'
import { createApiRequestFn } from '../codemode-tools'
import type { McpToolContext } from '../types'

jest.mock('../api-endpoint-index', () => ({
  getApiEndpoints: jest.fn(),
  getRawOpenApiSpec: jest.fn(),
}))

const mockedGetApiEndpoints = jest.mocked(getApiEndpoints)

function endpoint(path: string, method = 'GET'): ApiEndpoint {
  return {
    id: `${method} ${path}`,
    operationId: `${method} ${path}`,
    method,
    path,
    summary: '',
    description: '',
    tags: [],
    requiredFeatures: method === 'GET' ? [] : ['customers.companies.create'],
    parameters: [],
    requestBodySchema: null,
    deprecated: false,
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

describe('Code Mode redirect isolation (issue #7532)', () => {
  let applicationServer: Server
  let destinationServer: Server
  let applicationOrigin: string
  let destinationOrigin: string
  let redirectStatus: number
  let applicationRequests: { path: string; headers: IncomingHttpHeaders }[]
  let destinationRequests: IncomingHttpHeaders[]
  const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL
  const context: McpToolContext = {
    tenantId: 'tenant-redirect-test',
    organizationId: 'org-redirect-test',
    userId: 'user-redirect-test',
    userFeatures: ['ai_assistant.view', 'customers.companies.create'],
    isSuperAdmin: false,
    apiKeySecret: 'omk_synthetic.redirect-regression',
    container: {
      resolve: () => ({
        hasAllFeatures: (required: string[], granted: string[]) =>
          required.every((feature) => granted.includes(feature)),
      }),
    } as unknown as McpToolContext['container'],
  }

  beforeAll(async () => {
    destinationServer = createServer((request, response) => {
      destinationRequests.push(request.headers)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ reachedDestination: true }))
    })
    destinationOrigin = await listen(destinationServer)
    applicationServer = createServer((request, response) => {
      const path = new URL(request.url ?? '/', applicationOrigin).pathname
      applicationRequests.push({ path, headers: request.headers })
      if (path === '/api/json') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ records: [] }))
        return
      }
      const location = path === '/api/same-origin'
        ? `${applicationOrigin}/api/sso/initiate`
        : `${destinationOrigin}/authorize?state=synthetic-redirect-token`
      response.writeHead(redirectStatus, {
        Location: location,
        'Content-Type': 'application/json',
      })
      response.end(JSON.stringify({ redirectUrl: location }))
    })
    applicationOrigin = await listen(applicationServer)
    process.env.NEXT_PUBLIC_API_BASE_URL = applicationOrigin
  })

  beforeEach(() => {
    applicationRequests = []
    destinationRequests = []
    redirectStatus = 307
    mockedGetApiEndpoints.mockResolvedValue([
      endpoint('/api/sso/initiate'),
      endpoint('/api/same-origin'),
      endpoint('/api/json'),
      endpoint('/api/customers/companies', 'POST'),
    ])
  })

  afterAll(async () => {
    if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl
    await Promise.all([close(applicationServer), close(destinationServer)])
  })

  it.each([301, 302, 303, 307, 308])('blocks a %i SSO-shaped cross-origin redirect', async (status) => {
    redirectStatus = status
    const apiRequest = createApiRequestFn(context, () => {})

    const result = await apiRequest({
      method: 'GET',
      path: '/api/sso/initiate',
      query: { configId: 'synthetic-sso-config' },
    })

    expect(applicationRequests).toHaveLength(1)
    expect(applicationRequests[0].headers).toMatchObject({
      'x-api-key': context.apiKeySecret,
      'x-tenant-id': context.tenantId,
      'x-organization-id': context.organizationId,
    })
    expect(destinationRequests).toEqual([])
    expect(result).toEqual({
      success: false,
      statusCode: status,
      error: `API redirect ${status} blocked`,
    })
  })

  it.each([307, 308])('does not forward a POST body or credentials on a %i redirect', async (status) => {
    redirectStatus = status
    const apiRequest = createApiRequestFn(context, () => {})

    const result = await apiRequest({
      method: 'POST',
      path: '/api/customers/companies',
      body: { displayName: 'Synthetic private company' },
    })

    expect(applicationRequests).toHaveLength(1)
    expect(destinationRequests).toEqual([])
    expect(result).toEqual({
      success: false,
      statusCode: status,
      error: `API redirect ${status} blocked`,
    })
  })

  it('stops before a same-origin hop can lead to an external redirect', async () => {
    const apiRequest = createApiRequestFn(context, () => {})

    await apiRequest({ method: 'GET', path: '/api/same-origin' })

    expect(applicationRequests.map((request) => request.path)).toEqual(['/api/same-origin'])
    expect(destinationRequests).toEqual([])
  })

  it('preserves successful JSON requests', async () => {
    const apiRequest = createApiRequestFn(context, () => {})

    const result = await apiRequest({ method: 'GET', path: '/api/json' })

    expect(result).toEqual({ success: true, statusCode: 200, data: { records: [] } })
    expect(applicationRequests).toHaveLength(1)
    expect(destinationRequests).toEqual([])
  })
})
