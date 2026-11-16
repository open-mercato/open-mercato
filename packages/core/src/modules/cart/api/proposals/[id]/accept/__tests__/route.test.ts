// #8268 review Major 5 (re-review): this route used to honor a guard's denial but
// ignore its `modifiedPayload` — a transforming guard's rewritten acceptance
// selection was silently discarded and the original request body persisted instead.
// This proves the fix: when `runRouteMutationGuards` returns a `modifiedPayload`, it
// — not the raw parsed body — reaches the `cart.proposal.accept` command.

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const BASKET_ID = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'

const runRouteMutationGuardsMock = jest.fn()
const createRequestContainerMock = jest.fn()
const enforceCartRateLimitMock = jest.fn()
const resolveRouteContextOrErrorMock = jest.fn()
const resolveIdentifiedBasketByTokenMock = jest.fn()
const commandBusExecuteMock = jest.fn()

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))
jest.mock('../../../../../lib/rateLimit', () => ({
  enforceCartRateLimit: (...args: unknown[]) => enforceCartRateLimitMock(...args),
}))
jest.mock('../../../../../lib/currentCartRoute', () => ({
  CART_RESOURCE_KIND: 'cart:cart',
  buildCommandContext: () => ({}),
  mapRouteErrorToResponse: (error: unknown) => {
    throw error
  },
  notFoundCartResponse: () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }),
  readCartToken: () => 'token-1',
  resolveIdentifiedBasketByToken: (...args: unknown[]) => resolveIdentifiedBasketByTokenMock(...args),
  resolveRouteContextOrError: (...args: unknown[]) => resolveRouteContextOrErrorMock(...args),
}))

import { POST } from '../route'

function routeCtx() {
  return { params: Promise.resolve({ id: PROPOSAL_ID }) } as never
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/cart/proposals/x/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const acceptResult = {
  token: 'token-2',
  cart: { updatedAt: new Date('2026-01-01T00:00:00.000Z') },
  mergeSummary: {},
  priceChanges: [],
  acceptedLineCount: 1,
}

beforeEach(() => {
  jest.clearAllMocks()
  createRequestContainerMock.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'commandBus') return { execute: commandBusExecuteMock }
      throw new Error(`unexpected resolve: ${name}`)
    },
  })
  enforceCartRateLimitMock.mockResolvedValue(null)
  resolveRouteContextOrErrorMock.mockResolvedValue({
    ok: true,
    routeContext: { tenantId: TENANT_ID, organizationId: ORG_ID, customerUserId: null },
  })
  resolveIdentifiedBasketByTokenMock.mockResolvedValue({ id: BASKET_ID })
  commandBusExecuteMock.mockResolvedValue({ result: acceptResult })
})

describe('POST /api/cart/proposals/[id]/accept — guard modifiedPayload (Major 5)', () => {
  const LINE_ALLOWED = '55555555-5555-4555-8555-555555555555'
  const LINE_DENIED = '66666666-6666-4666-8666-666666666666'

  it('dispatches the guard-transformed acceptance selection, never the original request body', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: { acceptanceToken: 'token-guard', lines: [{ proposalLineId: LINE_ALLOWED, accepted: true }] },
      runAfterSuccess: jest.fn(async () => {}),
    })

    const res = await POST(
      jsonRequest({ acceptanceToken: 'token-original', lines: [{ proposalLineId: LINE_DENIED, accepted: true }] }),
      routeCtx(),
    )

    expect(res.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'cart.proposal.accept',
      expect.objectContaining({
        input: expect.objectContaining({
          acceptanceToken: 'token-guard',
          lines: [{ proposalLineId: LINE_ALLOWED, accepted: true }],
        }),
      }),
    )
  })

  it('dispatches the original parsed body when the guard reports no transformation', async () => {
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: undefined,
      runAfterSuccess: jest.fn(async () => {}),
    })

    const res = await POST(
      jsonRequest({ acceptanceToken: 'token-original', lines: [{ proposalLineId: LINE_ALLOWED, accepted: true }] }),
      routeCtx(),
    )

    expect(res.status).toBe(200)
    expect(commandBusExecuteMock).toHaveBeenCalledWith(
      'cart.proposal.accept',
      expect.objectContaining({
        input: expect.objectContaining({
          acceptanceToken: 'token-original',
          lines: [{ proposalLineId: LINE_ALLOWED, accepted: true }],
        }),
      }),
    )
  })
})
