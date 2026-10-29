const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getStatusMock = jest.fn()
const setValueMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'catalogCategorizationService') {
      return { getStatus: (...args: unknown[]) => getStatusMock(...args) }
    }
    if (name === 'moduleConfigService') {
      return { setValue: (...args: unknown[]) => setValueMock(...args) }
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

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
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

describe('catalog ai-categorization settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    setValueMock.mockResolvedValue(undefined)
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
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'catalog.ai_categorization_settings',
        resourceId: 'ai_categorization',
        operation: 'custom',
        requestMethod: 'PUT',
      }),
    )
    expect(setValueMock).toHaveBeenCalledWith(
      'catalog',
      'ai_categorization',
      expect.objectContaining({ enabled: true }),
      { tenantId },
    )
  })

  it('aborts the write before persisting when the guard blocks it', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })
    const response = await PUT(makePutRequest({ ...DEFAULT_SETTINGS, enabled: true }))
    expect(response.status).toBe(409)
    expect(setValueMock).not.toHaveBeenCalled()
  })
})
