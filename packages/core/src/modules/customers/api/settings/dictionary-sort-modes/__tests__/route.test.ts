const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const em = {}
const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()
const loadCustomerSettingsMock = jest.fn()
const invalidateDictionaryCacheMock = jest.fn()

const commandBus = { execute: commandBusExecuteMock }
const cache = { get: jest.fn(), set: jest.fn(), invalidateByTag: jest.fn() }
const container = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return em
    if (token === 'commandBus') return commandBus
    if (token === 'cache') return cache
    return {}
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    tenantId,
    orgId: organizationId,
    sub: userId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('../../../../commands/settings', () => ({
  loadCustomerSettings: (...args: unknown[]) => loadCustomerSettingsMock(...args),
}))

jest.mock('../../../dictionaries/cache', () => ({
  invalidateDictionaryCache: (...args: unknown[]) => invalidateDictionaryCacheMock(...args),
}))

import { GET, PATCH, metadata } from '../route'

describe('customer dictionary sort modes settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadCustomerSettingsMock.mockResolvedValue(null)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({
      result: {
        settingsId: '44444444-4444-4444-8444-444444444444',
        dictionarySortModes: { statuses: 'created_at_asc' },
      },
    })
    invalidateDictionaryCacheMock.mockResolvedValue(undefined)
  })

  it('returns configured dictionary sort modes', async () => {
    loadCustomerSettingsMock.mockResolvedValueOnce({
      dictionarySortModes: {
        statuses: 'created_at_asc',
        sources: 'label_desc',
        unknown: 'not-a-mode',
      },
    })

    const response = await GET(new Request('http://localhost/api/customers/settings/dictionary-sort-modes'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      dictionarySortModes: {
        statuses: 'created_at_asc',
        sources: 'label_desc',
      },
    })
  })

  it('merges partial PATCH payloads and runs mutation guards', async () => {
    loadCustomerSettingsMock.mockResolvedValueOnce({
      dictionarySortModes: {
        statuses: 'created_at_asc',
        sources: 'label_desc',
      },
    })
    commandBusExecuteMock.mockResolvedValueOnce({
      result: {
        settingsId: '44444444-4444-4444-8444-444444444444',
        dictionarySortModes: {
          statuses: 'label_asc',
          sources: 'label_desc',
        },
      },
    })

    const response = await PATCH(
      new Request('http://localhost/api/customers/settings/dictionary-sort-modes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dictionarySortModes: { statuses: 'label_asc' } }),
      }),
    )

    expect(metadata.PATCH.requireFeatures).toEqual(['customers.settings.manage'])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      dictionarySortModes: {
        statuses: 'label_asc',
        sources: 'label_desc',
      },
    })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.settings',
        resourceId: organizationId,
        operation: 'update',
        mutationPayload: expect.objectContaining({
          dictionarySortModes: {
            statuses: 'label_asc',
            sources: 'label_desc',
          },
        }),
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'customers.settings.save_dictionary_sort_modes',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId,
          organizationId,
          dictionarySortModes: {
            statuses: 'label_asc',
            sources: 'label_desc',
          },
        }),
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    expect(invalidateDictionaryCacheMock).toHaveBeenCalled()
  })
})
