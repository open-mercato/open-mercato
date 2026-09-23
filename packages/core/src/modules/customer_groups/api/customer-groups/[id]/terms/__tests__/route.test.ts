const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const GROUP_ID = '44444444-4444-4444-8444-444444444444'
const TERMS_ID = '55555555-5555-4555-8555-555555555555'

const runRouteMutationGuardsMock = jest.fn()

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

import { GET, PUT } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerGroup, CustomerGroupTerms } from '../../../../../data/entities'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const mockAuth = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>

function routeCtx() {
  return { params: Promise.resolve({ id: GROUP_ID }) } as never
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/customer-groups/x/terms', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

type FakeEmOptions = {
  group?: Partial<CustomerGroup> | null
  terms?: Partial<CustomerGroupTerms> | null
}

function createFakeEm({ group = null, terms = null }: FakeEmOptions) {
  const findOne = jest.fn(async (entity: unknown) => {
    if (entity === CustomerGroup) return group
    if (entity === CustomerGroupTerms) return terms
    return null
  })
  const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
    id: TERMS_ID,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...data,
  }))
  const persist = jest.fn()
  const flush = jest.fn(async () => {})
  const em: Record<string, unknown> = { findOne, create, persist, flush }
  em.fork = () => em
  return em as unknown as {
    findOne: typeof findOne
    create: typeof create
    persist: typeof persist
    flush: typeof flush
  }
}

function setupContainer(em: unknown) {
  mockContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as never)
}

const existingGroup: Partial<CustomerGroup> = {
  id: GROUP_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  code: 'wholesale',
  name: 'Wholesale',
  deletedAt: null,
}

const existingTerms: Partial<CustomerGroupTerms> = {
  id: TERMS_ID,
  groupId: GROUP_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  priceKindId: null,
  paymentTermsDays: 30,
  allowPurchaseOnAccount: true,
  defaultCreditLimit: '1500.00',
  creditCurrencyCode: 'USD',
  approvalRequiredAbove: null,
  minOrderValue: null,
  metadata: null,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-06-01T00:00:00.000Z'),
}

const oldOriginalEnv = process.env.OM_OPTIMISTIC_LOCK

beforeEach(() => {
  jest.clearAllMocks()
  process.env.OM_OPTIMISTIC_LOCK = 'all'
  mockAuth.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as never)
  runRouteMutationGuardsMock.mockResolvedValue({
    ok: true,
    modifiedPayload: undefined,
    runAfterSuccess: jest.fn(async () => {}),
  })
})

afterAll(() => {
  process.env.OM_OPTIMISTIC_LOCK = oldOriginalEnv
})

describe('GET /api/customer-groups/[id]/terms', () => {
  it('returns 404 when the group does not exist', async () => {
    setupContainer(createFakeEm({ group: null }))

    const res = await GET(new Request('http://localhost/api/customer-groups/x/terms'), routeCtx())
    expect(res.status).toBe(404)
  })

  it('returns { terms: null } when the group has no terms row (inheriting)', async () => {
    setupContainer(createFakeEm({ group: existingGroup, terms: null }))

    const res = await GET(new Request('http://localhost/api/customer-groups/x/terms'), routeCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ terms: null })
  })

  it('returns the serialized terms row when one exists', async () => {
    setupContainer(createFakeEm({ group: existingGroup, terms: existingTerms }))

    const res = await GET(new Request('http://localhost/api/customer-groups/x/terms'), routeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.terms).toMatchObject({
      id: TERMS_ID,
      groupId: GROUP_ID,
      paymentTermsDays: 30,
      allowPurchaseOnAccount: true,
      defaultCreditLimit: 1500,
      creditCurrencyCode: 'USD',
      updatedAt: '2025-06-01T00:00:00.000Z',
    })
  })
})

describe('PUT /api/customer-groups/[id]/terms', () => {
  it('returns 404 when the group does not exist', async () => {
    setupContainer(createFakeEm({ group: null }))

    const res = await PUT(jsonRequest({ paymentTermsDays: 10 }), routeCtx())
    expect(res.status).toBe(404)
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
  })

  it('creates a terms row when none exists yet (no lock check needed)', async () => {
    const em = createFakeEm({ group: existingGroup, terms: null })
    setupContainer(em)

    const res = await PUT(
      jsonRequest({ paymentTermsDays: 15, allowPurchaseOnAccount: true, defaultCreditLimit: 2000 }),
      routeCtx(),
    )

    expect(res.status).toBe(200)
    expect(em.create).toHaveBeenCalledWith(
      CustomerGroupTerms,
      expect.objectContaining({
        groupId: GROUP_ID,
        tenantId: TENANT_ID,
        paymentTermsDays: 15,
        allowPurchaseOnAccount: true,
        defaultCreditLimit: '2000',
      }),
    )
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { userId: USER_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        input: expect.objectContaining({
          resourceKind: 'customer_groups:customer_group_terms',
          resourceId: GROUP_ID,
          operation: 'create',
        }),
      }),
    )
    const body = await res.json()
    expect(body.terms.id).toBe(TERMS_ID)
  })

  it('updates only the submitted fields on an existing row', async () => {
    const em = createFakeEm({ group: existingGroup, terms: { ...existingTerms } })
    setupContainer(em)

    const res = await PUT(
      jsonRequest(
        { paymentTermsDays: 45 },
        { [OPTIMISTIC_LOCK_HEADER_NAME]: existingTerms.updatedAt!.toISOString() },
      ),
      routeCtx(),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.terms.paymentTermsDays).toBe(45)
    // Untouched fields survive the partial update.
    expect(body.terms.creditCurrencyCode).toBe('USD')
    expect(body.terms.defaultCreditLimit).toBe(1500)
    expect(em.create).not.toHaveBeenCalled()
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          resourceKind: 'customer_groups:customer_group_terms',
          resourceId: TERMS_ID,
          operation: 'update',
        }),
      }),
    )
  })

  it('409s on a stale optimistic-lock token against an existing row', async () => {
    const em = createFakeEm({ group: existingGroup, terms: { ...existingTerms } })
    setupContainer(em)

    const res = await PUT(
      jsonRequest(
        { paymentTermsDays: 45 },
        { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' },
      ),
      routeCtx(),
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not require a lock token on first creation', async () => {
    const em = createFakeEm({ group: existingGroup, terms: null })
    setupContainer(em)

    const res = await PUT(jsonRequest({ paymentTermsDays: 5 }), routeCtx())

    expect(res.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
  })

  it('returns the guard response when a mutation guard blocks the write', async () => {
    setupContainer(createFakeEm({ group: existingGroup, terms: null }))
    const blockedResponse = Response.json({ error: 'blocked' }, { status: 422 })
    runRouteMutationGuardsMock.mockResolvedValueOnce({
      ok: false,
      errorStatus: 422,
      errorBody: { error: 'blocked' },
      response: blockedResponse,
    })

    const res = await PUT(jsonRequest({ paymentTermsDays: 5 }), routeCtx())
    expect(res).toBe(blockedResponse)
  })
  it('maps a unique violation from a concurrent first save to a 409 conflict, not a 400/500', async () => {
    const em = createFakeEm({ group: existingGroup, terms: null })
    em.flush.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        constraint: 'customer_group_terms_group_unique',
      }),
    )
    setupContainer(em)

    const res = await PUT(jsonRequest({ paymentTermsDays: 5 }), routeCtx())

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('returns 500 and reports an unexpected write failure', async () => {
    const em = createFakeEm({ group: existingGroup, terms: null })
    const failure = new Error('connection reset')
    em.flush.mockRejectedValueOnce(failure)
    setupContainer(em)

    const res = await PUT(jsonRequest({ paymentTermsDays: 5 }), routeCtx())

    expect(res.status).toBe(500)
    expect(reportErrorMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ module: 'customer_groups', code: 'customer_groups.terms_put_failed' }),
    )
  })

  it('still answers 400 for invalid input without reporting it', async () => {
    setupContainer(createFakeEm({ group: existingGroup, terms: null }))

    const res = await PUT(jsonRequest({ paymentTermsDays: -5 }), routeCtx())

    expect(res.status).toBe(400)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/customer-groups/[id]/terms error reporting', () => {
  it('returns 500 and reports an unexpected read failure', async () => {
    const em = createFakeEm({ group: existingGroup, terms: null })
    const failure = new Error('connection reset')
    em.findOne.mockRejectedValueOnce(failure)
    setupContainer(em)

    const res = await GET(new Request('http://localhost/api/customer-groups/x/terms'), routeCtx())

    expect(res.status).toBe(500)
    expect(reportErrorMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ module: 'customer_groups', code: 'customer_groups.terms_get_failed' }),
    )
  })
})
