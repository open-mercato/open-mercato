import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '33333333-3333-4333-8333-333333333333'
const vocabulary = { won: ['signed'], lost: ['rejected'], closed: ['archived'] }
const responseBody = { vocabulary, source: 'tenant', updatedAt: '2026-10-18T09:00:00.000Z' }
const getAuthMock = jest.fn()
const userHasFeaturesMock = jest.fn()
const grantedFeaturesMock = jest.fn()
const executeMock = jest.fn()
const resolveVocabularyMock = jest.fn()
const runGuardsMock = jest.fn()
const afterSuccessMock = jest.fn()
const reportErrorMock = jest.fn()
const registeredGuards = [{ id: 'test.registry', targetEntity: '*', operations: ['update'], validate: jest.fn() }]
const legacyGuard = { id: 'test.legacy', targetEntity: '*', operations: ['update'], validate: jest.fn() }
const container = {
  resolve: (token: string) => {
    if (token === 'commandBus') return { execute: executeMock }
    if (token === 'rbacService') return { userHasAllFeatures: userHasFeaturesMock, getGrantedFeatures: grantedFeaturesMock }
    return undefined
  },
}

jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => getAuthMock(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: () => legacyGuard,
  runMutationGuards: (...args: unknown[]) => runGuardsMock(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({ getAllMutationGuardInstances: () => registeredGuards }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: reportErrorMock }) }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ child: () => ({ error: jest.fn() }) }) }))
jest.mock('../../../../lib/dealStatusVocabulary', () => ({
  DEAL_STATUS_VOCABULARY_RESOURCE_KIND: 'customers.deal_status_vocabulary',
  resolveDealStatusVocabulary: (...args: unknown[]) => resolveVocabularyMock(...args),
}))

import { GET, PUT, metadata } from '../route'

function request(body: unknown = { vocabulary }): Request {
  return new Request('http://localhost/api/customers/settings/deal-status-vocabulary', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('deal status vocabulary settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthMock.mockResolvedValue({ sub: userId, tenantId, orgId: null })
    userHasFeaturesMock.mockResolvedValue(true)
    grantedFeaturesMock.mockResolvedValue(['customers.deals.manage', 'record_locks.enforce'])
    resolveVocabularyMock.mockResolvedValue(responseBody)
    executeMock.mockResolvedValue({ result: responseBody })
    runGuardsMock.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    afterSuccessMock.mockResolvedValue(undefined)
  })

  it('allows viewers to read the authenticated tenant without an organization', async () => {
    expect(metadata.GET.requireFeatures).toEqual(['customers.deals.view'])
    expect(metadata.PUT.requireFeatures).toEqual(['customers.deals.manage'])
    const response = await GET(new Request('http://localhost/api/customers/settings/deal-status-vocabulary?tenantId=another-tenant'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(responseBody)
    expect(resolveVocabularyMock).toHaveBeenCalledWith(container, tenantId)
    expect(userHasFeaturesMock).toHaveBeenCalledWith(userId, ['customers.deals.view'], { tenantId, organizationId: null })
  })

  it('rejects missing auth and denies managers without permission', async () => {
    getAuthMock.mockResolvedValueOnce(null)
    expect((await GET(new Request('http://localhost/api/customers/settings/deal-status-vocabulary'))).status).toBe(401)
    userHasFeaturesMock.mockResolvedValueOnce(false)
    expect((await PUT(request())).status).toBe(403)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('rejects malformed, conflicting, or scope-spoofing payloads before guards', async () => {
    const invalidBodies = [
      { vocabulary: { ...vocabulary, won: [] } },
      { vocabulary: { ...vocabulary, lost: ['SIGNED'] } },
      { vocabulary, tenantId: 'other-tenant' },
    ]
    for (const body of invalidBodies) expect((await PUT(request(body))).status).toBe(400)
    expect(runGuardsMock).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('runs registry and legacy guards with actual grants and authenticated tenant scope', async () => {
    const response = await PUT(request())
    expect(response.status).toBe(200)
    expect(runGuardsMock).toHaveBeenCalledWith(
      [...registeredGuards, legacyGuard],
      expect.objectContaining({ tenantId, organizationId: null, userId, resourceId: tenantId, mutationPayload: { vocabulary } }),
      { userFeatures: ['customers.deals.manage', 'record_locks.enforce'] },
    )
    expect(executeMock).toHaveBeenCalledWith('customers.settings.save_deal_status_vocabulary', expect.objectContaining({
      input: { vocabulary }, ctx: expect.objectContaining({ auth: expect.objectContaining({ tenantId }) }),
    }))
    expect(await response.json()).toEqual(responseBody)
  })

  it('preserves guard rejection status and does not invoke the command', async () => {
    runGuardsMock.mockResolvedValueOnce({ ok: false, errorStatus: 423, errorBody: { error: 'Locked' }, afterSuccessCallbacks: [] })
    const response = await PUT(request())
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Locked' })
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('revalidates guard changes, supports reset, and calls afterSuccess', async () => {
    runGuardsMock.mockResolvedValueOnce({
      ok: true, modifiedPayload: { vocabulary: null },
      afterSuccessCallbacks: [{ guard: { afterSuccess: afterSuccessMock }, metadata: { lock: 'released' } }],
    })
    expect((await PUT(request())).status).toBe(200)
    expect(executeMock).toHaveBeenCalledWith('customers.settings.save_deal_status_vocabulary', expect.objectContaining({ input: { vocabulary: null } }))
    expect(afterSuccessMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId, resourceId: tenantId, metadata: { lock: 'released' } }))
    runGuardsMock.mockResolvedValueOnce({ ok: true, modifiedPayload: { vocabulary: { won: [] } }, afterSuccessCallbacks: [] })
    expect((await PUT(request())).status).toBe(400)
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('returns conflicts unchanged and keeps successful writes successful after callback errors', async () => {
    executeMock.mockRejectedValueOnce(new CrudHttpError(409, { error: 'Changed', code: 'optimistic_lock_conflict' }))
    expect((await PUT(request())).status).toBe(409)
    afterSuccessMock.mockRejectedValueOnce(new Error('Callback failed'))
    runGuardsMock.mockResolvedValueOnce({ ok: true, afterSuccessCallbacks: [{ guard: { afterSuccess: afterSuccessMock }, metadata: null }] })
    expect((await PUT(request())).status).toBe(200)
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ module: 'customers' }))
  })
})
