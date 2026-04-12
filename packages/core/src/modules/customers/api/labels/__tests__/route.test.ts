const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const selectedOrganizationId = '99999999-9999-4999-8999-999999999999'
const userId = '33333333-3333-4333-8333-333333333333'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) => {
    const hasOpts = opts && Object.keys(opts).length > 0
    return hasOpts ? emInstance.find(entity, filters, opts) : emInstance.find(entity, filters)
  },
  findOneWithDecryption: (emInstance: typeof em, entity: unknown, filters: unknown, opts?: Record<string, unknown>) => {
    const hasOpts = opts && Object.keys(opts).length > 0
    return hasOpts ? emInstance.findOne(entity, filters, opts) : emInstance.findOne(entity, filters)
  },
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: async (req: Request, fallback: unknown) => {
    try { return await req.json() } catch { return fallback }
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string) => fallback,
  })),
}))

import { GET, POST, metadata } from '../route'

describe('customer labels route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.find.mockResolvedValue([])
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: '44444444-4444-4444-8444-444444444444',
      ...payload,
    }))
    em.flush.mockResolvedValue(undefined)
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('requires manage access for label creation', () => {
    expect(metadata.POST.requireFeatures).toEqual(['customers.people.manage'])
  })

  it('creates labels for interactive staff auth using auth.sub as the actor id', async () => {
    const response = await POST(
      new Request('http://localhost/api/customers/labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Test label', organizationId }),
      }),
    )

    expect(response.status).toBe(201)
    expect(em.findOne).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        slug: 'test-label',
      }),
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        slug: 'test-label',
        label: 'Test label',
      }),
    )
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.label',
        resourceId: organizationId,
        operation: 'custom',
      }),
    )
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'customers.label',
        resourceId: organizationId,
        operation: 'custom',
      }),
    )
  })

  it('reads labels for the requested organization when an explicit organization override is provided', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/customers/labels?entityId=55555555-5555-4555-8555-555555555555&organizationId=${organizationId}`,
      ),
    )

    expect(response.status).toBe(200)
    expect(em.find).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
      }),
      expect.any(Object),
    )
  })

  it('returns an empty label payload when label tables are not installed yet', async () => {
    em.find.mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "customer_labels" does not exist',
    })

    const response = await GET(
      new Request('http://localhost/api/customers/labels?entityId=55555555-5555-4555-8555-555555555555'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [], assignedIds: [] })
  })

  it('returns an actionable error when label tables are missing for writes', async () => {
    em.findOne.mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "customer_labels" does not exist',
    })

    const response = await POST(
      new Request('http://localhost/api/customers/labels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Test label' }),
      }),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Customer label tables are missing. Run yarn db:migrate.',
    })
  })
})
