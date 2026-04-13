const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const companyId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const roleId = '55555555-5555-4555-8555-555555555555'

const mockCommandBus = {
  execute: jest.fn(),
}

const mockContext = {
  container: {
    resolve: jest.fn((token: string) => {
      if (token === 'commandBus') return mockCommandBus
      throw new Error(`Unexpected token: ${token}`)
    }),
  },
  em: {
    fork: jest.fn(),
  },
  auth: {
    sub: '66666666-6666-4666-8666-666666666666',
    tenantId,
    orgId: null,
    isSuperAdmin: true,
  },
  scope: {
    tenantId,
    selectedId: null,
    filterIds: null,
    allowedIds: null,
  },
  selectedOrganizationId: null,
  organizationIds: null,
  commandContext: {
    container: null,
    auth: {
      sub: '66666666-6666-4666-8666-666666666666',
      tenantId,
      orgId: null,
      isSuperAdmin: true,
    },
    organizationScope: {
      tenantId,
      selectedId: null,
      filterIds: null,
      allowedIds: null,
    },
    selectedOrganizationId: null,
    organizationIds: null,
    request: null,
  },
}
mockContext.commandContext.container = mockContext.container

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('../../../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(async () => mockContext),
  resolveAuthActorId: jest.fn(() => mockContext.auth.sub),
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: jest.fn(),
}))

describe('POST /api/customers/companies/[id]/roles', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCommandBus.execute.mockResolvedValue({
      result: { roleId },
      logEntry: null,
    })
    validateCrudMutationGuardMock.mockResolvedValue({
      ok: true,
      shouldRunAfterSuccess: true,
      metadata: { token: 'guard' },
    })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    findOneWithDecryptionMock.mockResolvedValue({
      id: companyId,
      kind: 'company',
      organizationId,
      tenantId,
    })
  })

  it('uses the target company scope when the current org selector is empty', async () => {
    const { POST } = await import('../route')

    const response = await POST(
      new Request(`http://localhost/api/customers/companies/${companyId}/roles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roleType: 'test', userId }),
      }),
      { params: { id: companyId } },
    )

    expect(response.status).toBe(201)
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      mockContext.em,
      expect.any(Function),
      expect.objectContaining({
        id: companyId,
        kind: 'company',
        deletedAt: null,
      }),
      undefined,
      {
        tenantId,
        organizationId: null,
      },
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      mockContext.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        resourceKind: 'customers.company',
        resourceId: companyId,
      }),
    )
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'customers.entityRoles.create',
      expect.objectContaining({
        input: expect.objectContaining({
          entityType: 'company',
          entityId: companyId,
          roleType: 'test',
          userId,
          organizationId,
          tenantId,
        }),
        ctx: expect.objectContaining({
          selectedOrganizationId: organizationId,
          organizationIds: [organizationId],
        }),
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      mockContext.container,
      expect.objectContaining({
        tenantId,
        organizationId,
        resourceKind: 'customers.company',
        resourceId: companyId,
      }),
    )
  })
})
