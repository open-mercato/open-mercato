/** @jest-environment node */
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockCreateRequestContainer = jest.fn()
const mockResolveEndpoints = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('../lib/endpoints', () => ({
  ...jest.requireActual('../lib/endpoints'),
  resolveXeroEndpoints: (...args: unknown[]) => mockResolveEndpoints(...args),
}))

import { XeroTestFakesUnavailableError } from '../lib/endpoints'
import { xeroHealthCheck } from '../lib/health'
import { createGrantPresenceCheck, resolveXeroRunOrigin } from '../lib/run-guard'
import { integration } from '../integration'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const PROVIDER_DATA = {
  xeroOrganisationId: '996096ec-5362-40dd-be90-3e6a2be09dce',
  xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a',
  xeroOrganisationName: 'Demo',
}

let grants: FakeGrantService

beforeEach(() => {
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  mockResolveEndpoints.mockReset().mockResolvedValue({
    authorize: 'https://login.xero.com/identity/connect/authorize',
    token: 'https://identity.xero.com/connect/token',
    revoke: 'https://identity.xero.com/connect/revocation',
    connections: 'https://api.xero.com/connections',
    accounting: 'https://api.xero.com/api.xro/2.0',
  })
  mockCreateRequestContainer.mockReset().mockImplementation(async () =>
    createFakeContainer({
      integrationCredentialsService: { resolve: async () => ({ clientId: 'c', clientSecret: 's' }) },
      integrationOAuthGrantService: grants.service,
    }),
  )
})

describe('xeroHealthCheck', () => {
  it('is declared on the integration and opens its own request container', async () => {
    expect(integration.healthCheck).toEqual({ service: 'xeroHealthCheck' })
    await xeroHealthCheck.check({ clientId: 'c' }, scope)
    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
  })

  it('reports a connected grant with a chosen Organisation as healthy, without a token', async () => {
    const result = await xeroHealthCheck.check({ clientId: 'c' }, scope)
    expect(result).toEqual({ status: 'healthy', details: { code: 'oauth.connected' } })
    expect(JSON.stringify(result)).not.toContain(grants.state.accessToken as string)
  })

  it('reports a connected grant without an Organisation as degraded xero.account_pending', async () => {
    grants.state.providerData = null
    await expect(xeroHealthCheck.check({ clientId: 'c' }, scope)).resolves.toEqual({ status: 'degraded', details: { code: 'xero.account_pending' } })
  })

  it.each([
    ['invalidated', (fake: FakeGrantService) => fake.setStatus('invalidated'), { status: 'unhealthy', details: { code: 'oauth.invalidated' } }],
    ['not connected', (fake: FakeGrantService) => fake.setStatus('none'), { status: 'unhealthy', details: { code: 'oauth.not_connected' } }],
    ['client changed', (fake: FakeGrantService) => { fake.state.clientChanged = true }, { status: 'unhealthy', details: { code: 'oauth.client_changed' } }],
    ['a transient refresh failure', (fake: FakeGrantService) => { fake.state.lastFailureClass = 'transient' }, { status: 'degraded', details: { code: 'oauth.transient' } }],
  ])('lets the core code win over Account pending when %s', async (_label, arrange, expected) => {
    grants.state.providerData = null
    arrange(grants)
    await expect(xeroHealthCheck.check({ clientId: 'c' }, scope)).resolves.toEqual(expected)
  })

  it('reports the seam fakes being gone as unhealthy xero.test_fakes_unavailable', async () => {
    mockResolveEndpoints.mockRejectedValueOnce(new XeroTestFakesUnavailableError())
    await expect(xeroHealthCheck.check({ clientId: 'om_test_seam_00' }, scope)).resolves.toEqual({
      status: 'unhealthy',
      details: { code: 'xero.test_fakes_unavailable' },
    })
  })

  it('makes no Xero call', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    await xeroHealthCheck.check({ clientId: 'c' }, scope)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(grants.calls.map((call) => call.method)).toEqual(['inspectGrant'])
    fetchSpy.mockRestore()
  })
})

describe('run origin and grant presence', () => {
  it('counts only triggeredBy scheduler as scheduled, and a missing run as scheduled', async () => {
    const runs = { getRun: jest.fn(async (runId: string) => (runId === 'a' ? { triggeredBy: 'scheduler' } : runId === 'b' ? { triggeredBy: 'user-1' } : null)) }
    await expect(resolveXeroRunOrigin(runs, 'a', scope)).resolves.toBe('scheduled')
    await expect(resolveXeroRunOrigin(runs, 'b', scope)).resolves.toBe('manual')
    await expect(resolveXeroRunOrigin(runs, 'missing', scope)).resolves.toBe('scheduled')
    await expect(resolveXeroRunOrigin(runs, undefined, scope)).resolves.toBe('scheduled')
  })

  it('reuses a present grant for at most one second and never reuses a missing one', async () => {
    let now = 0
    const readGrantStatus = jest.fn(async () => 'active' as const)
    const present = createGrantPresenceCheck({ readGrantStatus }, scope, () => now)
    await expect(present()).resolves.toBe(true)
    now = 999
    await expect(present()).resolves.toBe(true)
    expect(readGrantStatus).toHaveBeenCalledTimes(1)
    now = 1000
    readGrantStatus.mockResolvedValue(null as never)
    await expect(present()).resolves.toBe(false)
    await expect(present()).resolves.toBe(false)
    expect(readGrantStatus).toHaveBeenCalledTimes(3)
  })
})
