import { POST } from '../api/operators/route'
import { DELETE } from '../api/operators/[id]/route'
import { TillioApiError } from '../lib/errors'
import { TillioRevocationFailedError } from '../lib/operators'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('../lib/operators', () => ({
  ...jest.requireActual('../lib/operators'),
  attachOperator: jest.fn(),
  detachOperator: jest.fn(),
  readTillioIntegrationState: jest.fn(),
  resolveEnvironment: jest.fn(),
}))

const { getAuthFromRequest } = jest.requireMock('@open-mercato/shared/lib/auth/server')
const { createRequestContainer } = jest.requireMock('@open-mercato/shared/lib/di/container')
const { runRouteMutationGuards } = jest.requireMock('@open-mercato/shared/lib/crud/route-mutation-guard')
const {
  attachOperator,
  detachOperator,
  readTillioIntegrationState,
  resolveEnvironment,
} = jest.requireMock('../lib/operators')

const auth = { sub: 'user-1', tenantId: 'tn', orgId: 'org' }
const originalAppUrl = process.env.APP_URL

beforeEach(() => {
  jest.clearAllMocks()
  process.env.APP_URL = 'https://app.example.com'
  getAuthFromRequest.mockResolvedValue(auth)
  createRequestContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'integrationCredentialsService') return {}
      if (name === 'em') return {}
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
  runRouteMutationGuards.mockResolvedValue({
    ok: true,
    runAfterSuccess: jest.fn().mockResolvedValue(undefined),
  })
  resolveEnvironment.mockResolvedValue({
    apiUrl: 'https://provider.example.com',
    apiKey: 'api-key',
    tenantSystemId: 'OM-x',
    timeZone: 'Europe/Warsaw',
  })
  readTillioIntegrationState.mockResolvedValue({ enabled: true, healthy: true })
})

afterAll(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = originalAppUrl
})

describe('Tillio operator API diagnostics', () => {
  it('does not expose provider response text when attach fails', async () => {
    const providerMessage = 'provider response from https://internal.example.invalid: token secret-token'
    attachOperator.mockRejectedValue(new TillioApiError(providerMessage, 422, 'raw provider body'))

    const response = await POST(new Request('http://localhost/api/tillio/operators', {
      method: 'POST',
      body: JSON.stringify({ plugin: 'Ringostat', config: { key: 'operator-key' } }),
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body).toEqual({
      ok: false,
      code: 'provider_error',
      section: 'operator',
      message: 'Tillio rejected the request.',
    })
    expect(JSON.stringify(body)).not.toContain(providerMessage)
  })

  it('does not expose provider response text when detach fails', async () => {
    const providerMessage = 'provider response from https://internal.example.invalid: token secret-token'
    detachOperator.mockRejectedValue(new TillioRevocationFailedError(false, providerMessage))

    const response = await DELETE(
      new Request('http://localhost/api/tillio/operators/ringostat-1', { method: 'DELETE' }),
      { params: { id: 'ringostat-1' } },
    )
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toEqual({
      ok: false,
      code: 'revocation_failed',
      section: 'operator',
      message: 'The Tillio token could not be revoked.',
      canForce: true,
    })
    expect(JSON.stringify(body)).not.toContain(providerMessage)
  })
})
