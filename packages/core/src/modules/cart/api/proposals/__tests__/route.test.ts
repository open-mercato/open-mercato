/** @jest-environment node */

import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TARGET_CART_ID = '44444444-4444-4444-8444-444444444444'

type FakeCartRow = Record<string, unknown>

let seededTarget: FakeCartRow | null = null

function makeTargetCartRow(overrides: FakeCartRow = {}): FakeCartRow {
  return {
    id: TARGET_CART_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'basket',
    channel: 'storefront',
    storeId: '55555555-5555-4555-8555-555555555555',
    customerId: null,
    customerUserId: null,
    ...overrides,
  }
}

const mockFindOneWithDecryption = jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
  if (!seededTarget) return null
  if (where.id !== seededTarget.id) return null
  if (where.tenantId !== seededTarget.tenantId) return null
  if (where.organizationId !== seededTarget.organizationId) return null
  return seededTarget
})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...(args as [unknown, unknown, Record<string, unknown>])),
}))

const mockResolveForBuyer = jest.fn(async () => ({
  assortmentScope: { categoryIds: ['cat-1'], tagIds: [] },
  buyerDigest: 'digest',
  customerId: null,
  customerIds: [],
  customerGroupIds: [],
  customerUserId: null,
  currencyCode: null,
  taxMode: null,
  priceKindId: null,
}))

const mockCommandBusExecute = jest.fn(async () => ({
  result: { proposalCartId: 'proposal-1', lines: [], totals: {}, rejectedLines: [] },
}))

let guards: MutationGuard[] = []

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))

const fakeEm: FakeCartRow = {}
fakeEm.fork = jest.fn(() => fakeEm)

let storeContextServiceRegistered = true

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return fakeEm
    if (name === 'commandBus') return { execute: mockCommandBusExecute }
    if (name === 'storeContextService') {
      if (!storeContextServiceRegistered) throw new Error('service not registered: storeContextService')
      return { resolveForBuyer: mockResolveForBuyer }
    }
    throw new Error(`service not registered: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

const mockAuth = { sub: 'staff-1', tenantId: TENANT_ID, orgId: ORG_ID }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => mockAuth),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn(async () => ({
    targetCartId: TARGET_CART_ID,
    lines: [{ productId: '66666666-6666-4666-8666-666666666666', quantity: '1' }],
  })),
}))

import { POST } from '../route'

// MEDIUM fix (inherited review finding #6): `POST /api/cart/proposals` never resolved or
// forwarded `routeContext` to `cart.proposal.create`, so that command's own storefront-
// channel guard (`commands/proposal.ts`: `if (target.channel === 'storefront' &&
// !input.routeContext) throw 400`) rejected every proposal authored against a
// storefront-channel target — the common case, not an edge case.
describe('POST /api/cart/proposals — storefront-channel routeContext resolution (review finding #6)', () => {
  beforeEach(() => {
    mockCommandBusExecute.mockClear()
    mockResolveForBuyer.mockClear()
    storeContextServiceRegistered = true
    seededTarget = makeTargetCartRow()
  })

  it('resolves the target buyer\'s scope via storeContextService.resolveForBuyer and forwards it as routeContext for a storefront target', async () => {
    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockResolveForBuyer).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: seededTarget!.storeId,
      customerUserId: null,
      customerId: null,
    })
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { routeContext?: unknown } }).input.routeContext).toEqual({
      assortmentScope: { categoryIds: ['cat-1'], tagIds: [] },
    })
  })

  it('never resolves routeContext for a non-storefront target (pos/pay_link/agent/api)', async () => {
    seededTarget = makeTargetCartRow({ channel: 'pos' })
    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    await POST(request)

    expect(mockResolveForBuyer).not.toHaveBeenCalled()
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { routeContext?: unknown } }).input.routeContext).toBeUndefined()
  })

  it('degrades to no routeContext (never throws) when ecommerce/storeContextService is unavailable', async () => {
    storeContextServiceRegistered = false
    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(200)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { routeContext?: unknown } }).input.routeContext).toBeUndefined()
  })
})

// M12 fix (inherited review finding): this route dispatched `cart.proposal.create` without
// going through the route mutation-guard registry at all — unlike `api/proposals/[id]/
// accept/route.ts` and `api/proposals/[id]/reject/route.ts`, which already wire the shared
// `runRouteMutationGuards` wrapper for their own writes.
describe('POST /api/cart/proposals — mutation guard registry (review finding M12)', () => {
  beforeEach(() => {
    mockCommandBusExecute.mockClear()
    mockResolveForBuyer.mockClear()
    storeContextServiceRegistered = true
    seededTarget = makeTargetCartRow()
    guards = []
  })

  it('refuses with the guard\'s own status/body and never dispatches cart.proposal.create when a guard denies', async () => {
    const denyingGuard: MutationGuard = {
      id: 'test.deny-proposal-author',
      targetEntity: 'cart.cart',
      operations: ['create'],
      async validate() {
        return { ok: false, status: 422, body: { error: 'blocked by test guard', code: 'test_guard_blocked' } }
      },
    }
    guards = [denyingGuard]

    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'blocked by test guard', code: 'test_guard_blocked' })
    expect(mockCommandBusExecute).not.toHaveBeenCalled()
  })

  it('merges a transforming guard\'s modifiedPayload into the dispatched command input and still runs afterSuccess', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    const transformingGuard: MutationGuard = {
      id: 'test.transform-proposal-ttl',
      targetEntity: 'cart.cart',
      operations: ['create'],
      async validate() {
        return { ok: true, modifiedPayload: { ttlSeconds: 3600 }, shouldRunAfterSuccess: true }
      },
      afterSuccess,
    }
    guards = [transformingGuard]

    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockCommandBusExecute).toHaveBeenCalledTimes(1)
    const [, options] = mockCommandBusExecute.mock.calls[0]
    expect((options as { input: { ttlSeconds?: unknown } }).input.ttlSeconds).toBe(3600)
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('passes the caller\'s own userId (not "anonymous") to the guard registry for an authenticated author', async () => {
    const seenUserIds: Array<string> = []
    const recordingGuard: MutationGuard = {
      id: 'test.record-user-id',
      targetEntity: 'cart.cart',
      operations: ['create'],
      async validate(input) {
        seenUserIds.push(input.userId)
        return { ok: true }
      },
    }
    guards = [recordingGuard]

    const request = new Request('https://example.com/api/cart/proposals', { method: 'POST' })
    await POST(request)

    expect(seenUserIds).toEqual([mockAuth.sub])
  })
})
