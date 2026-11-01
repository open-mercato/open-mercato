/** @jest-environment node */

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const CART_ID = '44444444-4444-4444-8444-444444444444'

type FakeCartRow = Record<string, unknown>

let seededCart: FakeCartRow | null = null

function makeCartRow(overrides: FakeCartRow = {}): FakeCartRow {
  return {
    id: CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    status: 'active',
    channel: 'pos',
    storeId: null,
    customerId: null,
    customerUserId: null,
    salesChannelId: null,
    currencyCode: 'USD',
    locale: 'en-US',
    taxMode: 'gross',
    checkoutSessionId: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  if (!seededCart) return null
  if (where.id !== seededCart.id) return null
  if (where.tenantId !== seededCart.tenantId) return null
  const orgFilter = where.organizationId as { $in: string[] } | undefined
  if (orgFilter && !orgFilter.$in.includes(seededCart.organizationId as string)) return null
  if (where.kind && where.kind !== seededCart.kind) return null
  return seededCart
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

const mockCommandBusExecute = jest.fn(async () => ({ result: { cart: {}, priceChanges: [], warnings: undefined } }))
const fakeEm: FakeCartRow = {}
fakeEm.fork = jest.fn(() => fakeEm)
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return fakeEm
    if (name === 'commandBus') return { execute: mockCommandBusExecute }
    // `storeContextService` stays an unregistered (`ecommerce` disabled) soft peer by
    // default — the route's own `tryResolveStoreContextService` catches this.
    throw new Error(`service not registered: ${name}`)
  }),
}

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

const mockRunRouteMutationGuards = jest.fn(async () => ({ ok: true, runAfterSuccess: jest.fn(async () => undefined) }))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => mockRunRouteMutationGuards(...args),
}))

const mockBuildCartResponseEnvelope = jest.fn(async () => ({
  cart: { updatedAt: new Date('2026-01-02T00:00:00.000Z'), lines: [], totals: {}, requiresApproval: false },
  versionBumpReason: 'repricing',
}))

jest.mock('../../../../../lib/cartView', () => ({
  buildCartResponseEnvelope: (...args: unknown[]) => mockBuildCartResponseEnvelope(...args),
}))

import { metadata, POST } from '../route'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

function callPost(id: string, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost/api/cart/carts/${id}/reprice`, { method: 'POST', headers, body: '{}' }),
    { params: Promise.resolve({ id }) },
  )
}

const expectedHeader = { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-01-01T00:00:00.000Z' }

// Step 2.10 (K6/§10.2) — `POST /api/cart/carts/:id/reprice`: ACL gate declaration, the
// REQUIRED (not merely fail-open) optimistic-lock header, cart-status gating (active/
// abandoned only), tenant/organization isolation, and the trigger-7 dispatch shape.
describe('admin cart reprice route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    seededCart = makeCartRow()
    mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }
    mockOrgScope = { selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] }
    mockRunRouteMutationGuards.mockImplementation(async () => ({ ok: true, runAfterSuccess: jest.fn(async () => undefined) }))
  })

  it('declares cart.carts.manage on the ACL gate (§10.2)', () => {
    expect(metadata.POST.requireFeatures).toContain('cart.carts.manage')
  })

  it('answers 400 when the optimistic-lock header is missing (required, not fail-open)', async () => {
    const response = await callPost(CART_ID)
    expect(response.status).toBe(400)
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('answers 409 when the optimistic-lock header is stale', async () => {
    const response = await callPost(CART_ID, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2020-01-01T00:00:00.000Z' })
    expect(response.status).toBe(409)
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown cart', async () => {
    seededCart = null
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(404)
  })

  it('answers 404 for a cart in a different organization (tenant/org isolation)', async () => {
    mockOrgScope = { selectedId: OTHER_ORG_ID, filterIds: [OTHER_ORG_ID], allowedIds: [OTHER_ORG_ID] }
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(404)
  })

  it('answers 423 for a locked cart', async () => {
    seededCart = makeCartRow({ status: 'locked', checkoutSessionId: 'session-1' })
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(423)
  })

  it('answers 409 cart_not_active for a converted cart', async () => {
    seededCart = makeCartRow({ status: 'converted' })
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('cart_not_active')
  })

  it('accepts an abandoned cart (K6: active OR abandoned)', async () => {
    seededCart = makeCartRow({ status: 'abandoned' })
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(200)
    expect(mockCommandBusExecute).toHaveBeenCalledWith('cart.reprice', expect.objectContaining({
      input: expect.objectContaining({ trigger: 'admin_reprice', cartId: CART_ID }),
    }))
  })

  it('dispatches cart.reprice with trigger admin_reprice and no routeContext when ecommerce is absent', async () => {
    const response = await callPost(CART_ID, expectedHeader)
    expect(response.status).toBe(200)
    const [, options] = mockCommandBusExecute.mock.calls[0] as [string, { input: Record<string, unknown> }]
    expect(options.input.trigger).toBe('admin_reprice')
    expect(options.input.routeContext).toBeUndefined()
  })

  it('returns the §10.1 envelope with versionBumpReason "repricing"', async () => {
    const response = await callPost(CART_ID, expectedHeader)
    const body = await response.json()
    expect(body.versionBumpReason).toBe('repricing')
  })
})
