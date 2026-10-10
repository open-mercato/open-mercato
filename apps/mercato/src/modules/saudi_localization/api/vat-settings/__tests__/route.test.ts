const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const enforceOptimisticLockMock = jest.fn()
const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getRecord: (...args: unknown[]) => getRecordMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
    }
    if (name === 'rbacService') {
      return { userHasAllFeatures: (...args: unknown[]) => userHasAllFeaturesMock(...args) }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({
    scope: { tenantId: '11111111-1111-4111-8111-111111111111' },
    organizationId: '22222222-2222-4222-8222-222222222222',
  })),
}))

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

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => enforceOptimisticLockMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { GET, PUT } from '../route'

const validBody = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
  filingFrequency: 'quarterly' as const,
}

const makePutRequest = (body: unknown) =>
  new Request('http://localhost/api/saudi_localization/vat-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const STORED_UPDATED_AT = '2026-01-31T09:15:00.000Z'
const WRITTEN_UPDATED_AT = '2026-02-01T10:00:00.000Z'

const configRecord = (value: unknown, updatedAt: string) => ({
  moduleId: 'saudi_localization',
  name: 'vat',
  value,
  tenantId,
  organizationId,
  source: 'tenant' as const,
  createdAt: updatedAt,
  updatedAt,
})

describe('saudi VAT settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    enforceOptimisticLockMock.mockResolvedValue(undefined)
    getRecordMock.mockResolvedValue(null)
    setValueMock.mockResolvedValue(configRecord(validBody, WRITTEN_UPDATED_AT))
    userHasAllFeaturesMock.mockResolvedValue(true)
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null

    const response = await GET(new Request('http://localhost/api/saudi_localization/vat-settings'))

    expect(response.status).toBe(401)
  })

  it('returns the shipped defaults and marks them incomplete when nothing is stored', async () => {
    const response = await GET(new Request('http://localhost/api/saudi_localization/vat-settings'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sellerName: '',
      vatRegistrationNumber: '',
      commercialRegistrationNumber: null,
      vatRate: 0.15,
      invoiceQrEnabled: true,
      filingFrequency: 'quarterly',
      isComplete: false,
      canManage: true,
      updatedAt: null,
    })
    expect(getRecordMock).toHaveBeenCalledWith(
      'saudi_localization',
      'vat',
      { tenantId, organizationId },
    )
  })

  /**
   * The screen is reachable with `settings.view` alone, so a read-only caller
   * must still get the values — and must be told, by the same RBAC decision the
   * PUT guard makes, that the write is not theirs to make.
   */
  it('reports canManage false for a view-only caller and still returns the values', async () => {
    userHasAllFeaturesMock.mockResolvedValue(false)
    getRecordMock.mockResolvedValue(configRecord(validBody, STORED_UPDATED_AT))

    const response = await GET(new Request('http://localhost/api/saudi_localization/vat-settings'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...validBody,
      isComplete: true,
      canManage: false,
      updatedAt: STORED_UPDATED_AT,
    })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(
      userId,
      ['saudi_localization.settings.manage'],
      { tenantId, organizationId },
    )
  })

  it('returns the stored tenant values, their version and completeness', async () => {
    getRecordMock.mockResolvedValue(configRecord(validBody, STORED_UPDATED_AT))

    const response = await GET(new Request('http://localhost/api/saudi_localization/vat-settings'))

    await expect(response.json()).resolves.toEqual({
      ...validBody,
      isComplete: true,
      canManage: true,
      updatedAt: STORED_UPDATED_AT,
    })
  })

  it('persists the tenant-scoped settings, checks the expected version and runs the mutation guard', async () => {
    getRecordMock.mockResolvedValue(configRecord(validBody, STORED_UPDATED_AT))

    const response = await PUT(makePutRequest(validBody))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ...validBody,
      isComplete: true,
      canManage: true,
      updatedAt: WRITTEN_UPDATED_AT,
    })
    expect(setValueMock).toHaveBeenCalledWith(
      'saudi_localization',
      'vat',
      validBody,
      { tenantId, organizationId },
    )
    expect(enforceOptimisticLockMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        resourceKind: 'saudi_localization.settings',
        resourceId: 'vat',
        current: STORED_UPDATED_AT,
      }),
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

  it('refuses a stale write with the optimistic-lock conflict', async () => {
    getRecordMock.mockResolvedValue(configRecord(validBody, STORED_UPDATED_AT))
    enforceOptimisticLockMock.mockRejectedValue(
      new CrudHttpError(409, {
        error: 'record_modified',
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: STORED_UPDATED_AT,
        expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const response = await PUT(makePutRequest(validBody))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ code: 'optimistic_lock_conflict' }),
    )
    expect(setValueMock).not.toHaveBeenCalled()
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
