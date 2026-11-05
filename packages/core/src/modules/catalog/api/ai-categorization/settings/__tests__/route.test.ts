const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const runRouteMutationGuardsMock = jest.fn()
const getStatusMock = jest.fn()
const setValueMock = jest.fn()
const deleteByTagsMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') {
      return { getStatus: (...args: unknown[]) => getStatusMock(...args) }
    }
    if (name === 'moduleConfigService') {
      return { setValue: (...args: unknown[]) => setValueMock(...args) }
    }
    if (name === 'cache') {
      return { deleteByTags: (...args: unknown[]) => deleteByTagsMock(...args) }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

let authValue: Record<string, unknown> | null = { tenantId, sub: userId, orgId: organizationId }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { GET, PUT } from '../route'

const DEFAULT_SETTINGS = {
  enabled: false,
  applyMode: 'suggest' as const,
  autoApplyThreshold: 0.85,
  autoSuggestOnCreate: false,
}

const makePutRequest = (settings: Record<string, unknown>) =>
  new Request('http://localhost/api/catalog/ai-categorization/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
  })

const runAfterSuccessMock = jest.fn().mockResolvedValue(undefined)

describe('catalog ai-categorization settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    runAfterSuccessMock.mockClear().mockResolvedValue(undefined)
    runRouteMutationGuardsMock.mockResolvedValue({ ok: true, runAfterSuccess: runAfterSuccessMock })
    setValueMock.mockResolvedValue(undefined)
    deleteByTagsMock.mockResolvedValue(undefined)
    getStatusMock.mockResolvedValue({
      available: true,
      enabled: false,
      effective: false,
      settings: DEFAULT_SETTINGS,
    })
  })

  it('returns settings plus availability on GET', async () => {
    const response = await GET(new Request('http://localhost/api/catalog/ai-categorization/settings'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      available: true,
      effective: false,
    })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/catalog/ai-categorization/settings'))
    expect(response.status).toBe(401)
  })

  it('returns 422 when enabling while no decision model is available', async () => {
    getStatusMock.mockResolvedValue({
      available: false,
      reason: 'not_configured',
      enabled: false,
      effective: false,
      settings: DEFAULT_SETTINGS,
    })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ code: 'decision_model_unavailable', reason: 'not_configured' })
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('always allows disabling, even when unavailable', async () => {
    getStatusMock.mockResolvedValue({
      available: false,
      reason: 'not_configured',
      enabled: true,
      effective: false,
      settings: { ...DEFAULT_SETTINGS, enabled: true },
    })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: false }))
    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith(
      'catalog',
      'ai_categorization',
      expect.objectContaining({ enabled: false }),
      { tenantId },
    )
  })

  it('persists valid settings and runs the mutation guard', async () => {
    getStatusMock.mockResolvedValue({
      available: true,
      enabled: false,
      effective: false,
      settings: DEFAULT_SETTINGS,
    })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(200)
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        auth: { userId, tenantId, organizationId },
        input: expect.objectContaining({
          resourceKind: 'catalog.ai_categorization_settings',
          resourceId: 'ai_categorization',
          operation: 'custom',
        }),
      }),
    )
    expect(runAfterSuccessMock).toHaveBeenCalled()
    expect(setValueMock).toHaveBeenCalledWith(
      'catalog',
      'ai_categorization',
      expect.objectContaining({ enabled: true }),
      { tenantId },
    )
  })

  it('invalidates the tenant sidebar nav cache after saving so the review page entry reflects the new setting', async () => {
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(200)
    expect(deleteByTagsMock).toHaveBeenCalledWith([`nav:sidebar:tenant:${tenantId}`])
  })

  it('does not invalidate the nav cache when the write is blocked', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({ ok: false, errorStatus: 409, errorBody: { error: 'Conflict' }, response: new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 }) })
    await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(deleteByTagsMock).not.toHaveBeenCalled()
  })

  it('still succeeds when the nav cache invalidation fails', async () => {
    deleteByTagsMock.mockRejectedValue(new Error('cache down'))
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(200)
  })

  it('aborts the write before persisting when the guard blocks it', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({ ok: false, errorStatus: 409, errorBody: { error: 'Conflict' }, response: new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 }) })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(409)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('persists auto_apply with a threshold inside the allowed range', async () => {
    const response = await PUT(
      makePutRequest({ ...DEFAULT_SETTINGS, applyMode: 'auto_apply', autoApplyThreshold: 0.9 }),
    )
    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith(
      'catalog',
      'ai_categorization',
      expect.objectContaining({ applyMode: 'auto_apply', autoApplyThreshold: 0.9 }),
      { tenantId },
    )
  })

  it.each([0.49, 1, 0, -1])('rejects the out-of-range threshold %s with 400', async (threshold) => {
    const response = await PUT(
      makePutRequest({ ...DEFAULT_SETTINGS, applyMode: 'auto_apply', autoApplyThreshold: threshold }),
    )
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown apply mode with 400', async () => {
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, applyMode: 'always' }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400 instead of a 500', async () => {
    const response = await PUT(new Request('http://localhost/api/catalog/ai-categorization/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    }))
    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('persists a guard-transformed payload, not the original request body', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: { ...DEFAULT_SETTINGS, enabled: true, applyMode: 'auto_apply', autoApplyThreshold: 0.95 },
      runAfterSuccess: runAfterSuccessMock,
    })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(200)
    expect(setValueMock).toHaveBeenCalledWith(
      'catalog',
      'ai_categorization',
      expect.objectContaining({ applyMode: 'auto_apply', autoApplyThreshold: 0.95 }),
      { tenantId },
    )
  })
})
