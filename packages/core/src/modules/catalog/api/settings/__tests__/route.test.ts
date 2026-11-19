const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getValueMock = jest.fn()
const setValueMock = jest.fn()

let configsEnabled = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService' && configsEnabled) {
      return {
        getValue: (...args: unknown[]) => getValueMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import { GET, PUT } from '../route'

const makePutRequest = (unitPriceDisplayEnabled: boolean) =>
  new Request('http://localhost/api/catalog/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unitPriceDisplayEnabled }),
  })

describe('catalog settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    configsEnabled = true
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    getValueMock.mockResolvedValue(undefined)
    setValueMock.mockResolvedValue(undefined)
  })

  it('defaults unitPriceDisplayEnabled to true when no config row exists', async () => {
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: true })
    expect(getValueMock).toHaveBeenCalledWith(
      'catalog',
      'unit_price_display_enabled',
      expect.objectContaining({ defaultValue: true, scope: { tenantId } }),
    )
  })

  it('returns the stored tenant value when set to false', async () => {
    getValueMock.mockResolvedValue(false)
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: false })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(new Request('http://localhost/api/catalog/settings'))
    expect(response.status).toBe(401)
  })

  it('persists the tenant-scoped value and runs the mutation guard', async () => {
    const response = await PUT(makePutRequest(false))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: false })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'catalog.settings',
        resourceId: 'unit_price_display_enabled',
        operation: 'custom',
        requestMethod: 'PUT',
      }),
    )
    expect(setValueMock).toHaveBeenCalledWith('catalog', 'unit_price_display_enabled', false, { tenantId })
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'catalog.settings', metadata: { token: 'guard' } }),
    )
  })

  it('aborts the write before persisting when the guard blocks it', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    const response = await PUT(makePutRequest(true))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Conflict' })
    expect(setValueMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  describe('without the configs module', () => {
    beforeEach(() => {
      configsEnabled = false
    })

    it('GET returns the default instead of failing', async () => {
      const response = await GET(new Request('http://localhost/api/catalog/settings'))
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ unitPriceDisplayEnabled: true })
    })

    it('PUT returns 503 with a translated message before running the mutation guard', async () => {
      const response = await PUT(makePutRequest(false))
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        error: 'Catalog settings cannot be saved because the configs module is not enabled.',
      })
      expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
      expect(setValueMock).not.toHaveBeenCalled()
    })
  })
})
