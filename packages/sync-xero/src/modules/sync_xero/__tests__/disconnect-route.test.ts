/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveOrganizationScope = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { POST as disconnect, metadata } from '../api/post/disconnect/route'

const USER_ID = 'user-1'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const PROVIDER_DATA = {
  xeroOrganisationId: '996096ec-5362-40dd-be90-3e6a2be09dce',
  xeroConnectionId: 'a0a0a0a0-0000-4000-8000-00000000000a',
  xeroOrganisationName: 'Demo Company (Global)',
}

let grants: FakeGrantService
let features: Set<string>
let rbacFailure: Error | null
let credentials: Record<string, unknown> | null
const runHealthCheck = jest.fn()
const upsertState = jest.fn()
const saveCredentials = jest.fn()

function buildContainer() {
  return createFakeContainer({
    rbacService: {
      async userHasAllFeatures(_userId: string, required: string[]) {
        if (rbacFailure && required.includes('integrations.manage')) throw rbacFailure
        return required.every((feature) => features.has(feature))
      },
      async getGrantedFeatures() {
        return [...features]
      },
    },
    integrationCredentialsService: {
      resolve: async () => credentials,
      getRaw: async () => credentials,
      save: (...args: unknown[]) => saveCredentials(...args),
    },
    integrationOAuthGrantService: grants.service,
    integrationHealthService: { runHealthCheck: (...args: unknown[]) => runHealthCheck(...args) },
    integrationStateService: { upsert: (...args: unknown[]) => upsertState(...args) },
    em: {},
  })
}

function request(body: unknown = {}, revisedAt?: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (revisedAt) headers['x-om-ext-optimistic-lock-expected-updated-at'] = revisedAt
  return new Request('http://localhost:3000/api/sync_xero/disconnect', { method: 'POST', headers, body: JSON.stringify(body) })
}

function currentRevision(): string {
  return grants.state.revisedAt.toISOString()
}

function registerGuard(targetEntity: string, operations: MutationGuard['operations']): void {
  registerMutationGuards([
    {
      moduleId: 'test',
      guards: [
        {
          id: `test.block-${targetEntity}`,
          targetEntity,
          operations,
          validate: async () => ({ ok: false, status: 423, body: { error: 'Locked', code: 'record_locked' } }),
        },
      ],
    },
  ])
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  registerMutationGuards([])
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  features = new Set(['integrations.credentials.manage', 'integrations.manage', 'integrations.view'])
  rbacFailure = null
  credentials = { clientId: 'client-1', clientSecret: 'secret-1', weeklyFullResync: true }
  runHealthCheck.mockResolvedValue({ status: 'unhealthy' })
  upsertState.mockResolvedValue({ isEnabled: false })
  saveCredentials.mockResolvedValue(undefined)
  mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  mockCreateRequestContainer.mockImplementation(async () => buildContainer())
  mockResolveOrganizationScope.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: null, tenantId: TENANT_ID })
})

afterAll(() => {
  registerMutationGuards([])
})

describe('POST /api/sync_xero/disconnect', () => {
  it('requires integrations.credentials.manage', () => {
    expect(metadata).toEqual({ path: '/sync_xero/disconnect', POST: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] } })
  })

  it('erases and revokes the grant, runs one health check and disables the integration', async () => {
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      erased: true,
      revocation: 'confirmed',
      failureReason: null,
      steps: { healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'skipped' },
    })
    expect(grants.state.status).toBe('none')
    expect(grants.calls.find((call) => call.method === 'disconnect')?.options).toMatchObject({ force: false, actorUserId: USER_ID })
    expect(runHealthCheck).toHaveBeenCalledTimes(1)
    expect(runHealthCheck).toHaveBeenCalledWith('sync_xero', SCOPE)
    expect(upsertState).toHaveBeenCalledWith('sync_xero', { isEnabled: false }, SCOPE)
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('answers the core 409 for a stale revision and changes nothing', async () => {
    const response = await disconnect(request({}, '2020-01-01T00:00:00.000Z'))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'optimistic_lock_conflict' })
    expect(grants.state.status).toBe('active')
    expect(runHealthCheck).not.toHaveBeenCalled()
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('refuses an unreadable grant without force, then erases it without a revoke when forced', async () => {
    grants.setStatus('unavailable')
    const refused = await disconnect(request({}))
    expect(refused.status).toBe(409)
    expect(await json(refused)).toMatchObject({ code: 'disconnect_tokens_unreadable' })
    expect(upsertState).not.toHaveBeenCalled()

    const forced = await disconnect(request({ force: true }))
    expect(forced.status).toBe(200)
    expect(await json(forced)).toMatchObject({ erased: true, revocation: 'failed', failureReason: 'undecryptable' })
    expect(grants.calls.filter((call) => call.method === 'disconnect').at(-1)?.options).toMatchObject({ force: true })
  })

  it('answers 503 transient when the grant lock or database fails, and changes nothing', async () => {
    grants.failNext('disconnect', 'transient')
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({ code: 'transient' })
    expect(grants.state.status).toBe('active')
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('reports a failed revoke and still runs the remaining steps', async () => {
    const realDisconnect = grants.service.disconnect
    grants.service.disconnect = async (descriptor, owner, options) => {
      await realDisconnect(descriptor, owner, options)
      return { erased: true, disconnectId: 'd-1', revocation: 'failed', failureReason: 'temporarily_unavailable' }
    }
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body).toMatchObject({ erased: true, revocation: 'failed', failureReason: 'temporarily_unavailable' })
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'skipped' })
  })

  it('erases an invalidated grant without a revoke', async () => {
    grants.setStatus('invalidated')
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body).toMatchObject({ erased: true, revocation: 'skipped_invalidated' })
  })

  it('reports each failed follow-up step without undoing the erase', async () => {
    runHealthCheck.mockRejectedValue(new Error('[internal] health failed'))
    upsertState.mockRejectedValue(new Error('[internal] state failed'))
    saveCredentials.mockRejectedValue(new Error('[internal] save failed'))
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ erased: true, steps: { healthCheck: 'failed', disable: 'failed', removeClientCredentials: 'failed' } })
    expect(grants.state.status).toBe('none')
  })

  it('removes only the Client ID and Secret, keeping the other credential values', async () => {
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
    expect(saveCredentials).toHaveBeenCalledWith('sync_xero', { clientId: '', clientSecret: '', weeklyFullResync: true }, SCOPE)
  })

  it('reports the disable step as failed, not skipped, when the permission check itself fails', async () => {
    rbacFailure = new Error('rbac unavailable')
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'skipped' })
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('skips disabling the integration for an admin without integrations.manage', async () => {
    features = new Set(['integrations.credentials.manage'])
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'skipped', removeClientCredentials: 'skipped' })
    expect(upsertState).not.toHaveBeenCalled()
  })

  it('reports the follow-up steps as failed when an integration guard blocks them', async () => {
    registerGuard('integrations.integration', ['update'])
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ erased: true, steps: { healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'failed' } })
    expect(upsertState).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('returns the guard response when a guard blocks the grant delete', async () => {
    registerGuard('integrations.oauth_grant', ['delete'])
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(423)
    expect(grants.state.status).toBe('active')
  })

  it('answers erased false without a grant and runs no step', async () => {
    grants.setStatus('none')
    const body = await json(await disconnect(request({})))
    expect(body).toEqual({
      erased: false,
      revocation: null,
      failureReason: null,
      steps: { healthCheck: 'skipped', disable: 'skipped', removeClientCredentials: 'skipped' },
    })
    expect(runHealthCheck).not.toHaveBeenCalled()
  })

  it('rejects an unknown body field', async () => {
    const response = await disconnect(request({ force: true, cascade: true }))
    expect(response.status).toBe(400)
  })
})
