const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const setValueMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return { setValue: (...args: unknown[]) => setValueMock(...args) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const context = {
  container,
  auth: { tenantId, sub: userId },
  organizationId,
  tenantId,
}

jest.mock('@open-mercato/core/modules/translations/api/context', () => ({
  resolveTranslationsRouteContext: jest.fn(async () => context),
  requireTranslationFeatures: jest.fn(async () => undefined),
  resolveTranslationsActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import PUT from '../locales'

const makeRequest = () =>
  new Request('http://localhost/api/translations/locales', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locales: ['en', 'fr'] }),
  })

describe('translations locales route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    setValueMock.mockResolvedValue(undefined)
  })

  it('runs the mutation guard and after-success hook when updating supported locales', async () => {
    const response = await PUT(makeRequest())

    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'translations.locales',
        operation: 'custom',
        requestMethod: 'PUT',
      }),
    )
    expect(setValueMock).toHaveBeenCalledWith(
      'translations',
      'supported_locales',
      ['en', 'fr'],
      { tenantId },
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        resourceKind: 'translations.locales',
        operation: 'custom',
        metadata: { token: 'guard' },
      }),
    )
  })

  it('aborts the locale update before persisting when the guard blocks the write', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'Conflict' } })

    const response = await PUT(makeRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Conflict' })
    expect(setValueMock).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })
})
