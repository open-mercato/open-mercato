const mockGetCartSalesSnapshot = jest.fn(async () => ({ lines: [], adjustments: [], totals: {}, currencyCode: 'USD', updatedAt: new Date() }))
jest.mock('../toSalesSnapshots', () => ({
  getCartSalesSnapshot: (...args: unknown[]) => mockGetCartSalesSnapshot(...args),
}))

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn(async () => [])
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockResolveCartRouteContext = jest.fn()
class FakeCartStoreContextUnavailableError extends Error {}
jest.mock('../routeContext', () => ({
  resolveCartRouteContext: (...args: unknown[]) => mockResolveCartRouteContext(...args),
  isCartStoreContextUnavailableError: (err: unknown) => err instanceof FakeCartStoreContextUnavailableError,
}))

import { CartServiceImpl } from '../cartService'

function makeContainer(overrides: Record<string, unknown> = {}) {
  const commandBus = { execute: jest.fn(async () => ({ result: { cart: { status: 'locked' }, priceChanges: [], extended: false } })) }
  const registrations: Record<string, unknown> = {
    em: { fork: () => ({}) },
    commandBus,
    ...overrides,
  }
  return {
    commandBus,
    container: { resolve: (name: string) => registrations[name] },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CartServiceImpl.getSalesSnapshot (C7)', () => {
  it('forks a fresh em and delegates to getCartSalesSnapshot', async () => {
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    await service.getSalesSnapshot({ cartId: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', checkoutSessionId: 'session-1' })

    expect(mockGetCartSalesSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      { cartId: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', checkoutSessionId: 'session-1' },
    )
  })
})

describe('CartServiceImpl.lock — request-based routeContext resolution (C2)', () => {
  it('resolves a fresh routeContext from the request and forwards it to cart.lock when the caller supplies neither', async () => {
    const resolved = { tenantId: 't', organizationId: 'o', storeId: 's', channel: 'storefront' as const }
    mockResolveCartRouteContext.mockResolvedValue(resolved)
    const { container, commandBus } = makeContainer()
    const service = new CartServiceImpl(container)
    const request = new Request('https://example.com')

    await service.lock({ cartId: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', checkoutSessionId: 'session-1', request })

    expect(mockResolveCartRouteContext).toHaveBeenCalledWith(request, expect.anything(), { fresh: true })
    const call = (commandBus.execute as jest.Mock).mock.calls[0]
    expect(call[0]).toBe('cart.lock')
    expect(call[1].input.routeContext).toBe(resolved)
    expect(call[1].input.request).toBeUndefined()
  })

  it('leaves routeContext undefined when no request is supplied', async () => {
    const { container, commandBus } = makeContainer()
    const service = new CartServiceImpl(container)

    await service.lock({ cartId: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', checkoutSessionId: 'session-1' })

    expect(mockResolveCartRouteContext).not.toHaveBeenCalled()
    const call = (commandBus.execute as jest.Mock).mock.calls[0]
    expect(call[1].input.routeContext).toBeUndefined()
  })

  it('degrades to no routeContext when ecommerce is unavailable (never throws)', async () => {
    mockResolveCartRouteContext.mockRejectedValue(new FakeCartStoreContextUnavailableError('no ecommerce'))
    const { container, commandBus } = makeContainer()
    const service = new CartServiceImpl(container)

    await service.lock({
      cartId: 'cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      checkoutSessionId: 'session-1',
      request: new Request('https://example.com'),
    })

    const call = (commandBus.execute as jest.Mock).mock.calls[0]
    expect(call[1].input.routeContext).toBeUndefined()
  })

  it('does not call resolveCartRouteContext when the caller already supplies a routeContext', async () => {
    const { container, commandBus } = makeContainer()
    const service = new CartServiceImpl(container)
    const routeContext = { tenantId: 't', organizationId: 'o', storeId: 's', channel: 'storefront' as const }

    await service.lock({
      cartId: 'cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      checkoutSessionId: 'session-1',
      routeContext: routeContext as any,
      request: new Request('https://example.com'),
    })

    expect(mockResolveCartRouteContext).not.toHaveBeenCalled()
    const call = (commandBus.execute as jest.Mock).mock.calls[0]
    expect(call[1].input.routeContext).toBe(routeContext)
  })
})

describe('CartServiceImpl.resolveBasketByToken (Step 4.5, §5.1/§6.2, D-R5-21)', () => {
  it('returns null for an unknown token — never throws, same collapse as an unknown token elsewhere', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.resolveBasketByToken({ token: 'not-a-real-token' })

    expect(result).toBeNull()
    const [, , where] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ kind: 'basket' })
  })

  it('maps the matched basket to its plain identity fields, scope-free (no tenantId/organizationId filter)', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      storeId: 'store-1',
      status: 'active',
      customerId: 'customer-1',
      customerUserId: 'customer-user-1',
    })
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.resolveBasketByToken({ token: 'a-real-token' })

    expect(result).toEqual({
      id: 'cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      storeId: 'store-1',
      status: 'active',
      customerId: 'customer-1',
      customerUserId: 'customer-user-1',
    })
  })

  it('never calls `cart.get` / the command bus — a pure DB read, no re-price', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      storeId: null,
      status: 'active',
      customerId: null,
      customerUserId: null,
    })
    const { container, commandBus } = makeContainer()
    const service = new CartServiceImpl(container)

    await service.resolveBasketByToken({ token: 'a-real-token' })

    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})

describe('CartServiceImpl.getProposalCartPricedLines (Step 5.3, §7.1/§7.2, S22)', () => {
  it('returns null when the proposal cart no longer exists (purged, §10.3)', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.getProposalCartPricedLines({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      proposalCartId: 'proposal-cart-1',
    })

    expect(result).toBeNull()
    const [, , where] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ kind: 'proposal', id: 'proposal-cart-1' })
  })

  it('reads the pricing columns back verbatim — never recomputed (S22 byte-identical guarantee)', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'proposal-cart-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      currencyCode: 'USD',
      status: 'active',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    })
    mockFindWithDecryption.mockResolvedValueOnce([
      {
        id: 'line-1',
        cartId: 'proposal-cart-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        lineNumber: 1,
        productId: 'product-1',
        variantId: null,
        sku: 'SKU-1',
        name: 'Widget',
        optionValues: null,
        quantity: '2.0000',
        quantityUnit: null,
        unitPriceNet: '19.9900',
        unitPriceGross: '24.5877',
        taxRate: '0.2300',
        priceKindId: 'price-kind-1',
        priceRowId: 'price-row-1',
        priceTierMinQuantity: null,
        pricedAt: new Date(),
        lineTotals: { grandTotalGrossAmount: 49.1754 },
        discountTotalNet: null,
        promotionId: null,
        origin: 'customer',
        configuration: null,
        addedByActorType: 'rep',
        addedByActorId: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.getProposalCartPricedLines({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      proposalCartId: 'proposal-cart-1',
    })

    expect(result).toMatchObject({ currencyCode: 'USD', status: 'active' })
    expect(result?.lines).toEqual([
      {
        id: 'line-1',
        productId: 'product-1',
        variantId: null,
        sku: 'SKU-1',
        name: 'Widget',
        quantity: '2.0000',
        unitPriceNet: '19.9900',
        unitPriceGross: '24.5877',
        taxRate: '0.2300',
        priceKindId: 'price-kind-1',
        priceRowId: 'price-row-1',
        lineTotals: { grandTotalGrossAmount: 49.1754 },
      },
    ])
  })
})

describe('CartServiceImpl.getAttributionLines (Step 5.4, §5.5/§6.7, S18)', () => {
  it('returns null when the basket no longer exists', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.getAttributionLines({ tenantId: 'tenant-1', organizationId: 'org-1', cartId: 'cart-1' })

    expect(result).toBeNull()
    const [, , where] = mockFindOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({ kind: 'basket', id: 'cart-1' })
  })

  it('maps each live line\'s actor/amounts and resolves its originating proposal cart via CartMergeLog.outcome', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' })
    mockFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: 'line-buyer',
          addedByActorType: 'buyer',
          addedByActorId: 'customer-user-1',
          quantity: '1',
          lineTotals: { netAmount: 10, grossAmount: 12.3 },
        },
        {
          id: 'line-rep',
          addedByActorType: 'rep',
          addedByActorId: 'rep-1',
          quantity: '2',
          lineTotals: { netAmount: 20, grossAmount: 24.6 },
        },
      ])
      .mockResolvedValueOnce([
        {
          targetCartId: 'cart-1',
          proposalCartId: 'proposal-cart-1',
          outcome: [{ sourceLineId: 'source-line-1', targetLineId: 'line-rep', disposition: 'merged' }],
        },
      ])
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.getAttributionLines({ tenantId: 'tenant-1', organizationId: 'org-1', cartId: 'cart-1' })

    expect(result).toEqual({
      currencyCode: 'USD',
      lines: [
        { id: 'line-buyer', addedByActorType: 'buyer', addedByActorId: 'customer-user-1', netAmount: '10.0000', grossAmount: '12.3000', proposalCartId: null, proposalContributions: [], quantity: '1' },
        { id: 'line-rep', addedByActorType: 'rep', addedByActorId: 'rep-1', netAmount: '20.0000', grossAmount: '24.6000', proposalCartId: 'proposal-cart-1', proposalContributions: [{ proposalCartId: 'proposal-cart-1', quantity: '2' }], quantity: '2' },
      ],
    })
  })
  it('splits the units a proposal summed into a line the buyer already held, from the merge log\'s previous quantity', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'cart-1', tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'PLN' })
    mockFindWithDecryption
      .mockResolvedValueOnce([
        {
          id: 'line-shared',
          addedByActorType: 'buyer',
          addedByActorId: 'customer-user-1',
          quantity: '5',
          lineTotals: { netAmount: 250, grossAmount: 300 },
        },
      ])
      .mockResolvedValueOnce([
        {
          targetCartId: 'cart-1',
          proposalCartId: 'proposal-cart-1',
          createdAt: new Date('2026-10-30T10:00:00Z'),
          outcome: [{ sourceLineId: 'source-line-1', targetLineId: 'line-shared', disposition: 'summed', previousTargetQuantity: '2' }],
        },
      ])
    const { container } = makeContainer()
    const service = new CartServiceImpl(container)

    const result = await service.getAttributionLines({ tenantId: 'tenant-1', organizationId: 'org-1', cartId: 'cart-1' })

    expect(result?.lines[0]).toMatchObject({
      id: 'line-shared',
      quantity: '5',
      proposalCartId: 'proposal-cart-1',
      proposalContributions: [{ proposalCartId: 'proposal-cart-1', quantity: '3' }],
    })
  })
})
