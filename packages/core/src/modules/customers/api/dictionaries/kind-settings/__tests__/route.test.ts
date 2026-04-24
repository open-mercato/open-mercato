const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const commandBusExecuteMock = jest.fn()

const commandBus = { execute: commandBusExecuteMock }

jest.mock('../../context', () => ({
  resolveDictionaryRouteContext: jest.fn(async () => ({
    auth: { tenantId, sub: userId },
    container: { resolve: (token: string) => (token === 'commandBus' ? commandBus : {}) },
    ctx: {
      container: { resolve: (token: string) => (token === 'commandBus' ? commandBus : {}) },
      auth: { tenantId, sub: userId },
      organizationId,
      tenantId,
    },
    translate: (_key: string, fallback?: string) => fallback ?? 'error',
    em,
    organizationId,
    tenantId,
    readableOrganizationIds: [organizationId],
    cache: undefined,
  })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { GET, PATCH, metadata } from '../route'
import { resolveDictionaryRouteContext } from '../../context'

describe('customer dictionary kind settings route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: '44444444-4444-4444-8444-444444444444',
      ...payload,
    }))
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    commandBusExecuteMock.mockResolvedValue({
      result: {
        settingId: '44444444-4444-4444-8444-444444444444',
        created: true,
        kind: 'status',
        selectionMode: 'single',
        visibleInTags: false,
        sortOrder: 0,
      },
      logEntry: null,
    })
  })

  it('returns an empty list when the kind settings table is not installed yet', async () => {
    em.find.mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "customer_dictionary_kind_settings" does not exist',
    })

    const response = await GET(
      new Request('http://localhost/api/customers/dictionaries/kind-settings'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })

  it('passes organization overrides through to the kind settings context resolver', async () => {
    em.find.mockResolvedValueOnce([])

    await GET(
      new Request(`http://localhost/api/customers/dictionaries/kind-settings?organizationId=${organizationId}`),
    )

    expect(resolveDictionaryRouteContext).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ selectedId: organizationId }),
    )
  })

  it('requires settings manage access and runs the mutation guard for PATCH', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/customers/dictionaries/kind-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'status', visibleInTags: false }),
      }),
    )

    expect(metadata.PATCH.requireFeatures).toEqual(['customers.settings.manage'])
    expect(response.status).toBe(200)
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolve: expect.any(Function) }),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.settings',
        resourceId: organizationId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ resolve: expect.any(Function) }),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.settings',
        resourceId: organizationId,
        operation: 'custom',
      }),
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'customers.dictionaryKindSettings.upsert',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId,
          organizationId,
          kind: 'status',
          visibleInTags: false,
        }),
      }),
    )
  })
})
