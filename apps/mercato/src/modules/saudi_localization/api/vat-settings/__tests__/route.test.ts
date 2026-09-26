const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const getValueMock = jest.fn()
const setValueMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
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
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { GET, PUT } from '../route'

const validBody = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
}

const makePutRequest = (body: unknown) =>
  new Request('http://localhost/api/saudi/vat-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('saudi VAT settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    getValueMock.mockResolvedValue(null)
    setValueMock.mockResolvedValue(null)
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null

    const response = await GET(new Request('http://localhost/api/saudi/vat-settings'))

    expect(response.status).toBe(401)
  })

  it('returns the shipped defaults and marks them incomplete when nothing is stored', async () => {
    const response = await GET(new Request('http://localhost/api/saudi/vat-settings'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sellerName: '',
      vatRegistrationNumber: '',
      commercialRegistrationNumber: null,
      vatRate: 0.15,
      invoiceQrEnabled: true,
      isComplete: false,
    })
    expect(getValueMock).toHaveBeenCalledWith(
      'saudi_localization',
      'vat',
      { scope: { tenantId, organizationId } },
    )
  })

  it('returns the stored tenant values and marks them complete', async () => {
    getValueMock.mockResolvedValue(validBody)

    const response = await GET(new Request('http://localhost/api/saudi/vat-settings'))

    await expect(response.json()).resolves.toEqual({ ...validBody, isComplete: true })
  })

  it('persists the tenant-scoped settings and runs the mutation guard', async () => {
    const response = await PUT(makePutRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ...validBody, isComplete: true })
    expect(setValueMock).toHaveBeenCalledWith(
      'saudi_localization',
      'vat',
      validBody,
      { tenantId, organizationId },
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'saudi_localization.settings',
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a malformed VAT number without touching the store', async () => {
    const response = await PUT(makePutRequest({ ...validBody, vatRegistrationNumber: '30000000000000' }))

    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('rejects an Arabic seller name that cannot fit the 255-byte QR limit', async () => {
    const response = await PUT(makePutRequest({ ...validBody, sellerName: 'ا'.repeat(128) }))

    expect(response.status).toBe(400)
    expect(setValueMock).not.toHaveBeenCalled()
  })

  it('surfaces a rejected mutation guard as its own status', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'conflict' } })

    const response = await PUT(makePutRequest(validBody))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'conflict' })
    expect(setValueMock).not.toHaveBeenCalled()
  })
})
