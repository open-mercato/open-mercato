/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'

const mockCreateRequestContainer = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockReportError = jest.fn()
const mockEmitIntegrationsEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

jest.mock('@open-mercato/core/modules/integrations/events', () => ({
  emitIntegrationsEvent: (...args: unknown[]) => mockEmitIntegrationsEvent(...args),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/db/advisoryLock'),
  withAdvisoryXactLock: (...args: [unknown, string, (lockEm: unknown) => Promise<unknown>]) =>
    jest.requireActual('./support/memoryAdvisoryLock').memoryAdvisoryLock.run(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { memoryAdvisoryLock } from './support/memoryAdvisoryLock'
import { POST as disconnectRoute, metadata } from '../api/post/disconnect/route'

let currentAuth: AuthContext | undefined
const disconnect = (req: Request) => disconnectRoute(req, { auth: currentAuth })

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

const CONNECTION_LOCK_KEY = `sync_xero_connection:${TENANT_ID}:${ORG_ID}`

function rawRequest(body: string): Request {
  return new Request('http://localhost:3000/api/sync_xero/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
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

function registerTransformer(targetEntity: string, operations: MutationGuard['operations'], modifiedPayload: Record<string, unknown>): void {
  registerMutationGuards([
    {
      moduleId: 'test',
      guards: [{ id: `test.transform-${targetEntity}`, targetEntity, operations, validate: async () => ({ ok: true, modifiedPayload }) }],
    },
  ])
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  memoryAdvisoryLock.reset()
  registerMutationGuards([])
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
  features = new Set(['integrations.credentials.manage', 'integrations.manage', 'integrations.view'])
  rbacFailure = null
  credentials = { clientId: 'client-1', clientSecret: 'secret-1', weeklyFullResync: true }
  runHealthCheck.mockResolvedValue({ status: 'unhealthy' })
  upsertState.mockResolvedValue({ isEnabled: false, reauthRequired: false })
  mockEmitIntegrationsEvent.mockResolvedValue(undefined)
  saveCredentials.mockResolvedValue(undefined)
  currentAuth = { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID }
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

  it('answers 401 when the dispatcher passes no auth, without touching the grant', async () => {
    const response = await disconnectRoute(request({}, currentRevision()))
    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ code: 'unauthorized' })
    expect(grants.calls).toEqual([])
  })

  it('creates one request container per request and authorizes against it', async () => {
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(200)
    expect(mockCreateRequestContainer).toHaveBeenCalledTimes(1)
    expect(mockResolveOrganizationScope).toHaveBeenCalledWith(expect.objectContaining({ container: await mockCreateRequestContainer.mock.results[0].value }))
  })

  it('erases and revokes the grant, runs one health check and disables the integration', async () => {
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      erased: true,
      revocation: 'confirmed',
      failureReason: null,
      steps: { healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'skipped' },
      reconnected: false,
    })
    expect(grants.state.status).toBe('none')
    expect(grants.calls.find((call) => call.method === 'disconnect')?.options).toMatchObject({ force: false, actorUserId: USER_ID })
    expect(runHealthCheck).toHaveBeenCalledTimes(1)
    expect(runHealthCheck).toHaveBeenCalledWith('sync_xero', SCOPE)
    expect(upsertState).toHaveBeenCalledWith('sync_xero', { isEnabled: false }, SCOPE)
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent.mock.calls).toEqual([[
      'integrations.state.updated',
      { integrationId: 'sync_xero', isEnabled: false, reauthRequired: false, tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID },
    ]])
  })

  it('answers the core 409 for a stale revision and changes nothing', async () => {
    const response = await disconnect(request({}, '2020-01-01T00:00:00.000Z'))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'optimistic_lock_conflict' })
    expect(grants.state.status).toBe('active')
    expect(runHealthCheck).not.toHaveBeenCalled()
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('refuses an unreadable grant without force, then erases it without a revoke when forced', async () => {
    grants.setStatus('unavailable')
    const refused = await disconnect(request({}))
    expect(refused.status).toBe(409)
    expect(await json(refused)).toMatchObject({ code: 'disconnect_tokens_unreadable' })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()

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
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
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
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('keeps a written step ok and reports it when its integrations event cannot be emitted', async () => {
    mockEmitIntegrationsEvent.mockRejectedValue(new Error('[internal] bus down'))
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'sync_xero', code: 'sync_xero.disconnect_disable_event_failed' })
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'sync_xero', code: 'sync_xero.disconnect_removeClientCredentials_event_failed' })
  })

  it('removes only the Client ID and Secret, keeping the other credential values', async () => {
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
    expect(saveCredentials).toHaveBeenCalledWith('sync_xero', { clientId: '', clientSecret: '', weeklyFullResync: true }, SCOPE)
    expect(mockEmitIntegrationsEvent).toHaveBeenCalledWith('integrations.credentials.updated', {
      integrationId: 'sync_xero',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
    })
  })

  it('reports the disable step as failed, not skipped, when the permission check itself fails', async () => {
    rbacFailure = new Error('rbac unavailable')
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'skipped' })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('skips disabling the integration for an admin without integrations.manage', async () => {
    features = new Set(['integrations.credentials.manage'])
    const body = await json(await disconnect(request({}, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'skipped', removeClientCredentials: 'skipped' })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('reports the follow-up steps as failed when an integration guard blocks them', async () => {
    registerGuard('integrations.integration', ['update'])
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ erased: true, steps: { healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'failed' } })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('returns the guard response when a guard blocks the grant delete', async () => {
    registerGuard('integrations.oauth_grant', ['delete'])
    const response = await disconnect(request({}, currentRevision()))
    expect(response.status).toBe(423)
    expect(grants.state.status).toBe('active')
  })

  it('honors a grant-delete guard that withdraws force', async () => {
    grants.setStatus('unavailable')
    registerTransformer('integrations.oauth_grant', ['delete'], { force: false })
    const response = await disconnect(request({ force: true }))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'disconnect_tokens_unreadable' })
    expect(grants.calls.filter((call) => call.method === 'disconnect').at(-1)?.options).toMatchObject({ force: false })
  })

  it('refuses with 422 guard_payload_invalid when a grant-delete guard changes the integration, adds force or returns an invalid force', async () => {
    for (const modifiedPayload of [{ integrationId: 'gateway_stripe' }, { force: true }, { force: 'yes' }]) {
      registerTransformer('integrations.oauth_grant', ['delete'], modifiedPayload)
      const response = await disconnect(request({}, currentRevision()))
      expect(response.status).toBe(422)
      expect(await json(response)).toMatchObject({ code: 'guard_payload_invalid' })
    }
    expect(grants.state.status).toBe('active')
  })

  it('skips a follow-up step an integration guard turns off', async () => {
    registerTransformer('integrations.integration', ['update'], { isEnabled: true, removeClientCredentials: false })
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ erased: true, steps: { healthCheck: 'ok', disable: 'skipped', removeClientCredentials: 'skipped' } })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('fails the follow-up steps when an integration guard adds a step the admin did not ask for or may not run', async () => {
    registerTransformer('integrations.integration', ['update'], { removeClientCredentials: true })
    const added = await json(await disconnect(request({}, currentRevision())))
    expect(added.steps).toEqual({ healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'skipped' })
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'sync_xero', code: 'sync_xero.disconnect_disable_failed' })

    grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA })
    features = new Set(['integrations.credentials.manage'])
    registerTransformer('integrations.integration', ['update'], { isEnabled: false })
    const escalated = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(escalated.steps).toEqual({ healthCheck: 'ok', disable: 'skipped', removeClientCredentials: 'failed' })
    expect(upsertState).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('answers erased false without a grant and runs no step', async () => {
    grants.setStatus('none')
    const body = await json(await disconnect(request({})))
    expect(body).toEqual({
      erased: false,
      revocation: null,
      failureReason: null,
      steps: { healthCheck: 'skipped', disable: 'skipped', removeClientCredentials: 'skipped' },
      reconnected: false,
    })
    expect(runHealthCheck).not.toHaveBeenCalled()
  })

  it('rejects an unknown body field', async () => {
    const response = await disconnect(request({ force: true, cascade: true }))
    expect(response.status).toBe(400)
  })

  it.each([
    ['malformed JSON', '{"removeClientCredentials": true'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
  ])('answers 400 for %s before erasing anything', async (_label, body) => {
    const response = await disconnect(rawRequest(body))
    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({ code: 'invalid_request' })
    expect(grants.calls.some((call) => call.method === 'disconnect')).toBe(false)
    expect(grants.state.status).toBe('active')
    expect(runHealthCheck).not.toHaveBeenCalled()
  })

  it('reads an empty body as no options', async () => {
    const response = await disconnect(rawRequest(''))
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({ erased: true, steps: { disable: 'ok', removeClientCredentials: 'skipped' } })
  })

  it('runs no destructive follow-up when core reports the owner reconnected before the revoke', async () => {
    const realDisconnect = grants.service.disconnect
    grants.service.disconnect = async (descriptor, owner, options) => {
      const erased = await realDisconnect(descriptor, owner, options)
      grants.connect(PROVIDER_DATA)
      return erased.erased ? { ...erased, revocation: 'skipped_reconnected', failureReason: null } : erased
    }
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toEqual({
      erased: true,
      revocation: 'skipped_reconnected',
      failureReason: null,
      steps: { healthCheck: 'skipped', disable: 'skipped', removeClientCredentials: 'skipped' },
      reconnected: true,
    })
    expect(grants.state.status).toBe('active')
    expect(upsertState).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
  })

  it('keeps a Reconnect stored between the health check and the cleanup writes', async () => {
    runHealthCheck.mockImplementation(async () => {
      grants.connect(PROVIDER_DATA)
      return { status: 'healthy' }
    })
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({
      erased: true,
      revocation: 'confirmed',
      steps: { healthCheck: 'ok', disable: 'skipped', removeClientCredentials: 'skipped' },
      reconnected: true,
    })
    expect(grants.state.status).toBe('active')
    expect(upsertState).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(mockEmitIntegrationsEvent).not.toHaveBeenCalled()
    expect(memoryAdvisoryLock.keys).toEqual([CONNECTION_LOCK_KEY])
  })

  it('checks for a live grant and writes the cleanup while holding the Xero connection lock', async () => {
    const heldDuring: boolean[] = []
    const realReadStatus = grants.service.readGrantStatus
    grants.service.readGrantStatus = async (integrationId, scope) => {
      heldDuring.push(memoryAdvisoryLock.isHeld(CONNECTION_LOCK_KEY))
      return realReadStatus(integrationId, scope)
    }
    upsertState.mockImplementation(async () => {
      heldDuring.push(memoryAdvisoryLock.isHeld(CONNECTION_LOCK_KEY))
      return { isEnabled: false, reauthRequired: false }
    })
    saveCredentials.mockImplementation(async () => {
      heldDuring.push(memoryAdvisoryLock.isHeld(CONNECTION_LOCK_KEY))
    })
    runHealthCheck.mockImplementation(async () => {
      heldDuring.push(memoryAdvisoryLock.isHeld(CONNECTION_LOCK_KEY))
      return { status: 'unhealthy' }
    })
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
    expect(heldDuring).toEqual([false, true, true, true])
  })

  it('makes a Reconnect that reaches the lock during the cleanup wait until the cleanup is written', async () => {
    let releaseCleanup: () => void = () => undefined
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    let cleanupStarted: () => void = () => undefined
    const cleanupReached = new Promise<void>((resolve) => {
      cleanupStarted = resolve
    })
    upsertState.mockImplementation(async () => {
      cleanupStarted()
      await cleanupGate
      return { isEnabled: false, reauthRequired: false }
    })
    const pending = disconnect(request({ removeClientCredentials: true }, currentRevision()))
    await cleanupReached
    const order: string[] = []
    const reconnect = memoryAdvisoryLock.run(null, CONNECTION_LOCK_KEY, async () => {
      order.push(`reconnect sees saved credentials: ${saveCredentials.mock.calls.length > 0}`)
    })
    await Promise.resolve()
    expect(order).toEqual([])
    releaseCleanup()
    const body = await json(await pending)
    await reconnect
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
    expect(order).toEqual(['reconnect sees saved credentials: true'])
  })

  it('fails the cleanup unwritten when the grant status cannot be read', async () => {
    grants.service.readGrantStatus = async () => 'unavailable'
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ steps: { healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'failed' }, reconnected: false })
    expect(upsertState).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'sync_xero', code: 'sync_xero.disconnect_disable_failed' })
  })

  it('fails the cleanup unwritten when the Xero connection lock is unavailable', async () => {
    memoryAdvisoryLock.failNext('deadline')
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body).toMatchObject({ erased: true, steps: { healthCheck: 'ok', disable: 'failed', removeClientCredentials: 'failed' } })
    expect(grants.state.status).toBe('none')
    expect(upsertState).not.toHaveBeenCalled()
    expect(saveCredentials).not.toHaveBeenCalled()
  })

  it('keeps the cleanup outcome when the lock commit fails after the writes', async () => {
    memoryAdvisoryLock.failNext('commit_unknown')
    const body = await json(await disconnect(request({ removeClientCredentials: true }, currentRevision())))
    expect(body.steps).toEqual({ healthCheck: 'ok', disable: 'ok', removeClientCredentials: 'ok' })
  })
})
