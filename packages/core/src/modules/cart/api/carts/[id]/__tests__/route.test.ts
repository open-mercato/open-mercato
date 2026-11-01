/** @jest-environment node */

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const CART_ID = '44444444-4444-4444-8444-444444444444'

type FakeCartRow = Record<string, unknown>

let seededCart: FakeCartRow | null = null
let seededMergeLogs: FakeCartRow[] = []
let seededCustomer: FakeCartRow | null = null

function makeCartRow(overrides: FakeCartRow = {}): FakeCartRow {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    status: 'active',
    channel: 'storefront',
    storeId: null,
    customerId: null,
    customerUserId: null,
    email: 'buyer@example.com',
    note: 'a private note',
    proposedToCartId: null,
    approvalId: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
  if (entity === CustomerEntity) {
    if (!seededCustomer) return null
    if (where.id !== seededCustomer.id) return null
    if (where.tenantId !== seededCustomer.tenantId) return null
    if (where.organizationId !== seededCustomer.organizationId) return null
    return seededCustomer
  }
  if (!seededCart) return null
  if (where.id !== seededCart.id) return null
  if (where.tenantId !== seededCart.tenantId) return null
  const orgFilter = where.organizationId as { $in: string[] } | undefined
  if (orgFilter && !orgFilter.$in.includes(seededCart.organizationId as string)) return null
  if (where.kind && where.kind !== seededCart.kind) return null
  return seededCart
})

const mockFindWithDecryption = jest.fn(async () => seededMergeLogs)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const fakeEm: FakeCartRow = {}
fakeEm.fork = jest.fn(() => fakeEm)
const container = { resolve: jest.fn((name: string) => (name === 'em' ? fakeEm : undefined)) }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

let mockAuth: { sub: string; tenantId: string | null; orgId: string | null } | null = {
  sub: 'staff-1',
  tenantId: TENANT_ID,
  orgId: ORG_ID,
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => mockAuth),
}))

let mockOrgScope: { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null } | null = null

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => mockOrgScope),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

const mockBuildCartResponseEnvelope = jest.fn(async () => ({
  cart: { updatedAt: new Date('2026-01-01T00:00:00.000Z'), lines: [], totals: {}, requiresApproval: false },
}))

jest.mock('../../../../lib/cartView', () => ({
  buildCartResponseEnvelope: (...args: unknown[]) => mockBuildCartResponseEnvelope(...args),
}))

let mockApprovalService: { getApproval: jest.Mock } | null = null

jest.mock('../../../../lib/adminCartScope', () => {
  const actual = jest.requireActual('../../../../lib/adminCartScope')
  return {
    ...actual,
    tryResolveCustomerPurchaseApprovalService: jest.fn(() => mockApprovalService),
  }
})

import { GET } from '../route'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

// Step 2.10 (K6/§10.2) — `GET /api/cart/carts/:id`. Exercises tenant/org isolation, the
// 404-on-unknown-cart posture, and BOTH `customer_groups` approval branches (present vs.
// absent, per the task's own "test BOTH branches" requirement).
describe('admin cart detail route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seededCart = makeCartRow()
    seededMergeLogs = []
    seededCustomer = null
    mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }
    mockOrgScope = { selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] }
    mockApprovalService = null
  })

  function callGet(id: string = CART_ID) {
    return GET(new Request(`http://localhost/api/cart/carts/${id}`), { params: Promise.resolve({ id }) })
  }

  it('answers 401 when unauthenticated', async () => {
    mockAuth = null
    const response = await callGet()
    expect(response.status).toBe(401)
  })

  it('answers 404 for an unknown cart id', async () => {
    seededCart = null
    const response = await callGet()
    expect(response.status).toBe(404)
  })

  it('answers 404 for a cart in a different organization (tenant/org isolation)', async () => {
    mockOrgScope = { selectedId: OTHER_ORG_ID, filterIds: [OTHER_ORG_ID], allowedIds: [OTHER_ORG_ID] }
    const response = await callGet()
    expect(response.status).toBe(404)
  })

  it('answers 404 for a cart in a different tenant', async () => {
    seededCart = makeCartRow({ tenantId: 'some-other-tenant' })
    const response = await callGet()
    expect(response.status).toBe(404)
  })

  it('returns the decrypted email/note and admin-only fields on a live cart', async () => {
    const response = await callGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.cart.email).toBe('buyer@example.com')
    expect(body.cart.note).toBe('a private note')
    expect(body.cart.kind).toBe('basket')
    expect(body.cart.channel).toBe('storefront')
  })

  it('reads the approval live when customer_groups’ approval service is registered', async () => {
    seededCart = makeCartRow({ approvalId: 'approval-1' })
    mockApprovalService = {
      getApproval: jest.fn(async () => ({ id: 'approval-1', status: 'approved', amountGross: '100.00', currencyCode: 'USD' })),
    }
    const response = await callGet()
    const body = await response.json()
    expect(mockApprovalService.getApproval).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      approvalId: 'approval-1',
    })
    expect(body.approval).toEqual({ id: 'approval-1', status: 'approved', amountGross: '100.00', currencyCode: 'USD' })
  })

  it('degrades to a null approval with no error when the approval service is absent', async () => {
    seededCart = makeCartRow({ approvalId: 'approval-1' })
    mockApprovalService = null
    const response = await callGet()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.approval).toBeNull()
  })

  it('returns a null approval (no service call) when the cart has no approvalId', async () => {
    mockApprovalService = { getApproval: jest.fn() }
    const response = await callGet()
    const body = await response.json()
    expect(body.approval).toBeNull()
    expect(mockApprovalService.getApproval).not.toHaveBeenCalled()
  })

  // Regression (bug 16, round-4 QA): customerName was resolved with a plain `em.findOne`
  // against `CustomerEntity.displayName`, an encrypted column, so admins saw ciphertext;
  // the lookup also had no organizationId filter at all. Must go through
  // `findOneWithDecryption`, scoped to the cart's own organization.
  it('resolves the decrypted customerName, scoped to the cart\'s own organization', async () => {
    seededCart = makeCartRow({ customerId: 'customer-1' })
    seededCustomer = { id: 'customer-1', tenantId: TENANT_ID, organizationId: ORG_ID, displayName: 'Alice Buyer' }
    const response = await callGet()
    const body = await response.json()
    expect(body.cart.customerName).toBe('Alice Buyer')
  })

  it('does not resolve a customer from a different organization', async () => {
    seededCart = makeCartRow({ customerId: 'customer-1' })
    seededCustomer = { id: 'customer-1', tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, displayName: 'Someone Else' }
    const response = await callGet()
    const body = await response.json()
    expect(body.cart.customerName).toBeNull()
  })

  it('maps CartMergeLog rows into the response', async () => {
    seededMergeLogs = [
      {
        id: 'merge-1',
        strategy: 'sum',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        mergedByActorType: 'buyer',
        proposalCartId: null,
      },
    ]
    const response = await callGet()
    const body = await response.json()
    expect(body.mergeLogEntries).toHaveLength(1)
    expect(body.mergeLogEntries[0]).toMatchObject({ id: 'merge-1', strategy: 'sum', mergedByActorType: 'buyer' })
  })
})
