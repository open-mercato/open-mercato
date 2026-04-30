const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const selectedOrganizationId = '99999999-9999-4999-8999-999999999999'
const userId = '33333333-3333-4333-8333-333333333333'
const labelId = '44444444-4444-4444-8444-444444444444'
const entityId = '55555555-5555-4555-8555-555555555555'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  remove: jest.fn(),
  flush: jest.fn(),
}

const commandBusExecuteMock = jest.fn()
const commandBus = {
  execute: (...args: unknown[]) => commandBusExecuteMock(...args),
}

const userHasAllFeaturesMock = jest.fn()
const rbacService = {
  userHasAllFeatures: (...args: unknown[]) => userHasAllFeaturesMock(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'commandBus') return commandBus
    if (name === 'rbacService') return rbacService
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: selectedOrganizationId,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async ({ selectedId }: { selectedId?: string }) => ({
    tenantId,
    selectedId: selectedId ?? selectedOrganizationId,
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.find(entity, filters, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown, opts?: unknown) =>
    emInstance.findOne(entity, filters, opts),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: async (req: Request, fallback: unknown) => {
    try { return await req.json() } catch { return fallback }
  },
}))

import { POST as assignLabel, metadata as assignMetadata } from '../assign/route'
import { POST as unassignLabel, metadata as unassignMetadata } from '../unassign/route'

describe('customer label route scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: '66666666-6666-4666-8666-666666666666',
      ...payload,
    }))
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    userHasAllFeaturesMock.mockResolvedValue(true)
    commandBusExecuteMock.mockResolvedValue({
      result: {
        assignmentId: '77777777-7777-4777-8777-777777777777',
        created: true,
        entityKind: 'person',
      },
      logEntry: null,
    })
  })

  it('requires authentication for label assignment writes', () => {
    expect(assignMetadata.POST.requireAuth).toBe(true)
    expect(unassignMetadata.POST.requireAuth).toBe(true)
    expect((assignMetadata.POST as { requireFeatures?: string[] }).requireFeatures).toBeUndefined()
    expect((unassignMetadata.POST as { requireFeatures?: string[] }).requireFeatures).toBeUndefined()
  })

  it('assigns label with person resourceKind and checks customers.people.manage', async () => {
    em.findOne.mockResolvedValueOnce({ id: entityId, kind: 'person' })

    const response = await assignLabel(
      new Request('http://localhost/api/customers/labels/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(201)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(
      userId,
      ['customers.people.manage'],
      { tenantId, organizationId },
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'customers.labels.assign',
      expect.objectContaining({
        input: expect.objectContaining({
          labelId,
          entityId,
          tenantId,
          organizationId,
        }),
      }),
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: entityId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        resourceKind: 'customers.person',
      }),
    )
  })

  it('assigns label with company resourceKind and checks customers.companies.manage', async () => {
    em.findOne.mockResolvedValueOnce({ id: entityId, kind: 'company' })

    const response = await assignLabel(
      new Request('http://localhost/api/customers/labels/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(201)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(
      userId,
      ['customers.companies.manage'],
      { tenantId, organizationId },
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        resourceKind: 'customers.company',
        resourceId: entityId,
      }),
    )
  })

  it('returns 403 when actor lacks the kind-appropriate manage feature', async () => {
    em.findOne.mockResolvedValueOnce({ id: entityId, kind: 'company' })
    userHasAllFeaturesMock.mockResolvedValueOnce(false)

    const response = await assignLabel(
      new Request('http://localhost/api/customers/labels/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(403)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
  })

  it('unassigns label with scoped mutation guard and kind-appropriate feature check', async () => {
    em.findOne.mockResolvedValueOnce({ id: entityId, kind: 'person' })

    const response = await unassignLabel(
      new Request('http://localhost/api/customers/labels/unassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(
      userId,
      ['customers.people.manage'],
      { tenantId, organizationId },
    )
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'customers.labels.unassign',
      expect.objectContaining({
        input: expect.objectContaining({
          labelId,
          entityId,
          tenantId,
          organizationId,
        }),
      }),
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: entityId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
  })

  it('unassign returns 403 when actor lacks the kind-appropriate manage feature', async () => {
    em.findOne.mockResolvedValueOnce({ id: entityId, kind: 'company' })
    userHasAllFeaturesMock.mockResolvedValueOnce(false)

    const response = await unassignLabel(
      new Request('http://localhost/api/customers/labels/unassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(403)
    expect(commandBusExecuteMock).not.toHaveBeenCalled()
    expect(validateCrudMutationGuardMock).not.toHaveBeenCalled()
  })
})
