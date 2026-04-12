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

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
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
  })

  it('requires manage access for label assignment writes', () => {
    expect(assignMetadata.POST.requireFeatures).toEqual(['customers.people.manage'])
    expect(unassignMetadata.POST.requireFeatures).toEqual(['customers.people.manage'])
  })

  it('scopes label assignment lookups to the selected organization', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: labelId })
      .mockResolvedValueOnce({ id: entityId })
      .mockResolvedValueOnce(null)

    const response = await assignLabel(
      new Request('http://localhost/api/customers/labels/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(201)
    expect(em.findOne).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({
        id: labelId,
        tenantId,
        organizationId,
        userId,
      }),
      {},
    )
    expect(em.findOne).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
      }),
      {},
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
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: entityId,
        operation: 'custom',
      }),
    )
  })

  it('scopes label unassignment lookups to the selected organization', async () => {
    em.findOne
      .mockResolvedValueOnce({ id: labelId })
      .mockResolvedValueOnce({ id: entityId })
      .mockResolvedValueOnce({ id: '77777777-7777-4777-8777-777777777777' })

    const response = await unassignLabel(
      new Request('http://localhost/api/customers/labels/unassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ labelId, entityId, organizationId }),
      }),
    )

    expect(response.status).toBe(200)
    expect(em.findOne).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({
        id: labelId,
        tenantId,
        organizationId,
        userId,
      }),
      {},
    )
    expect(em.findOne).toHaveBeenNthCalledWith(
      3,
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
      }),
      {},
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
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.person',
        resourceId: entityId,
        operation: 'custom',
      }),
    )
  })
})
