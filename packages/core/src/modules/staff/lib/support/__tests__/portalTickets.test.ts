const TENANT = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION = '22222222-2222-4222-8222-222222222222'
const OWN_CUSTOMER = '33333333-3333-4333-8333-333333333333'
const OTHER_CUSTOMER = '44444444-4444-4444-8444-444444444444'
const OWN_TASK = '55555555-5555-4555-8555-555555555555'
const FOREIGN_TASK = '66666666-6666-4666-8666-666666666666'

type TaskRow = {
  id: string
  tenantId: string
  organizationId: string
  customerId: string | null
  source: string
  deletedAt: Date | null
}

const taskRows: TaskRow[] = [
  { id: OWN_TASK, tenantId: TENANT, organizationId: ORGANIZATION, customerId: OWN_CUSTOMER, source: 'portal', deletedAt: null },
  { id: FOREIGN_TASK, tenantId: TENANT, organizationId: ORGANIZATION, customerId: OTHER_CUSTOMER, source: 'portal', deletedAt: null },
]

const findOneCalls: Array<Record<string, unknown>> = []

function matches(row: TaskRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
}

const em = {
  fork: () => em,
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    findOneCalls.push(where)
    return taskRows.find((row) => matches(row, where)) ?? null
  }),
}

let grantedFeatures: string[] = ['portal.support_tickets.view']

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'customerRbacService') {
      return {
        userHasAllFeatures: async (_userId: string, required: string[]) =>
          required.every((feature) => grantedFeatures.includes(feature)),
      }
    }
    throw new Error(`[internal] Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

const ticketLookups: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    ticketLookups.push(where)
    return { id: 'ticket-row', taskId: where.taskId, supportReference: 'SUP-1' }
  }),
  findWithDecryption: jest.fn(async () => []),
}))

let customerAuthValue: Record<string, unknown> | null = null

const customerFeatureGuard = jest.fn(
  async (
    auth: { sub: string },
    features: string[],
    rbac: { userHasAllFeatures: (userId: string, required: string[]) => Promise<boolean> },
  ) => {
    if (!(await rbac.userHasAllFeatures(auth.sub, features))) {
      throw new Response(JSON.stringify({ ok: false, error: 'Insufficient permissions' }), { status: 403 })
    }
  },
)

let mockCustomerFeatureGuard: unknown = customerFeatureGuard

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => customerAuthValue),
  get requireCustomerFeature() {
    return mockCustomerFeatureGuard
  },
}))

import {
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  listPortalTicketPage,
  loadPortalOwnedTicket,
  portalOwnedTaskWhere,
  resolveSupportPortalScope,
} from '../portalTickets'

const scopeBase = { tenantId: TENANT, organizationId: ORGANIZATION, customerId: OWN_CUSTOMER }

function signedIn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'customer-user-1',
    sid: 'session-1',
    type: 'customer',
    tenantId: TENANT,
    orgId: ORGANIZATION,
    email: 'client@example.com',
    customerEntityId: OWN_CUSTOMER,
    ...overrides,
  }
}

const request = () => new Request('http://localhost/api/staff/portal/support-tickets')

beforeEach(() => {
  findOneCalls.length = 0
  ticketLookups.length = 0
  grantedFeatures = [PORTAL_SUPPORT_TICKETS_VIEW_FEATURE]
  customerAuthValue = signedIn()
  mockCustomerFeatureGuard = customerFeatureGuard
})

describe('portalOwnedTaskWhere', () => {
  it('pins tenant, organization, the task customer, the portal source and live rows', () => {
    expect(portalOwnedTaskWhere(scopeBase)).toEqual({
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      customerId: OWN_CUSTOMER,
      source: 'portal',
      deletedAt: null,
    })
  })

  it('never consults the project customer', () => {
    expect(Object.keys(portalOwnedTaskWhere(scopeBase))).not.toContain('timeProjectId')
  })
})

describe('loadPortalOwnedTicket', () => {
  it('loads an owned ticket with the ownership clause in the same query', async () => {
    const owned = await loadPortalOwnedTicket({ ...scopeBase, em: em as never }, OWN_TASK)
    expect(owned?.task.id).toBe(OWN_TASK)
    expect(findOneCalls[0]).toEqual({ id: OWN_TASK, ...portalOwnedTaskWhere(scopeBase) })
    expect(ticketLookups[0]).toEqual({ taskId: OWN_TASK, tenantId: TENANT, organizationId: ORGANIZATION, deletedAt: null })
  })

  it('answers null for a ticket of another company without reading its ticket row', async () => {
    const owned = await loadPortalOwnedTicket({ ...scopeBase, em: em as never }, FOREIGN_TASK)
    expect(owned).toBeNull()
    expect(findOneCalls[0]).toMatchObject({ id: FOREIGN_TASK, customerId: OWN_CUSTOMER })
    expect(ticketLookups).toHaveLength(0)
  })
})

describe('resolveSupportPortalScope', () => {
  it('answers 401 without a portal session', async () => {
    customerAuthValue = null
    const result = await resolveSupportPortalScope(request(), PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('answers 403 when the portal user is not linked to a customer entity', async () => {
    customerAuthValue = signedIn({ customerEntityId: null })
    const result = await resolveSupportPortalScope(request(), PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    expect((result as Response).status).toBe(403)
    expect(await (result as Response).json()).toEqual({
      ok: false,
      error: 'staff.errors.customerAccountNotLinked',
      code: 'customer_account_not_linked',
    })
  })

  it('answers 403 when the required feature is missing', async () => {
    grantedFeatures = []
    const result = await resolveSupportPortalScope(request(), PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    expect((result as Response).status).toBe(403)
  })

  it('fails closed with 403 when the feature guard cannot be resolved', async () => {
    mockCustomerFeatureGuard = undefined
    const result = await resolveSupportPortalScope(request(), PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    expect((result as Response).status).toBe(403)
  })

  it('takes tenant, organization and customer from the session', async () => {
    const result = await resolveSupportPortalScope(request(), PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    expect(result).not.toBeInstanceOf(Response)
    const scope = result as Exclude<typeof result, Response>
    expect(scope.tenantId).toBe(TENANT)
    expect(scope.organizationId).toBe(ORGANIZATION)
    expect(scope.customerId).toBe(OWN_CUSTOMER)
    expect(await scope.hasFeature('portal.support_tickets.manage')).toBe(false)
  })
})

describe('listPortalTicketPage', () => {
  it('returns an empty page without querying when a status filter matches no column', async () => {
    const getKysely = jest.fn()
    const page = await listPortalTicketPage(
      { ...scopeBase, em: { getKysely } as never },
      { statusIds: [], limit: 20, offset: 0 },
    )
    expect(page).toEqual({ rows: [], total: 0 })
    expect(getKysely).not.toHaveBeenCalled()
  })
})
