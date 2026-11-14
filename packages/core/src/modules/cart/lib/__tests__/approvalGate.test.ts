import {
  computeGoodsGrossAmount,
  computeRequiresApproval,
  resolveCartRequiresApproval,
  tryResolveCustomerGroupsService,
} from '../approvalGate'

// Step 3.1 (K1/K2, §9a.1/§9a.2) — unit coverage for the gate's own pure math and its one
// soft-DI read, independent of `cart.reprice`/`cart.lock`'s own integration tests
// (`lib/__tests__/reprice.test.ts`, `commands/__tests__/lock.test.ts`).

describe('computeGoodsGrossAmount', () => {
  it('reads a numeric grandTotalGrossAmount off the totals snapshot', () => {
    expect(computeGoodsGrossAmount({ grandTotalGrossAmount: 24 })).toBe(24)
  })

  it('reads a string grandTotalGrossAmount (e.g. a decimal snapshot) too', () => {
    expect(computeGoodsGrossAmount({ grandTotalGrossAmount: '24.50' })).toBe(24.5)
  })

  it('falls back to 0, never NaN, for a missing or non-numeric value', () => {
    expect(computeGoodsGrossAmount({})).toBe(0)
    expect(computeGoodsGrossAmount(null)).toBe(0)
    expect(computeGoodsGrossAmount(undefined)).toBe(0)
    expect(computeGoodsGrossAmount({ grandTotalGrossAmount: 'not-a-number' })).toBe(0)
  })
})

describe('computeRequiresApproval (§9a.2)', () => {
  it('is false when no threshold is set, regardless of currency or amount', () => {
    expect(
      computeRequiresApproval({
        approvalRequiredAbove: null,
        termsCurrencyCode: null,
        cartCurrencyCode: 'USD',
        goodsGrossAmount: 1_000_000,
      }),
    ).toBe(false)
  })

  it('is true (fail-closed) on a currency mismatch, even below the threshold', () => {
    expect(
      computeRequiresApproval({
        approvalRequiredAbove: 1000,
        termsCurrencyCode: 'EUR',
        cartCurrencyCode: 'USD',
        goodsGrossAmount: 1,
      }),
    ).toBe(true)
  })

  it('is true (fail-closed) when termsCurrencyCode is null, even below the threshold (D-R5-4/D-R5-37)', () => {
    expect(
      computeRequiresApproval({
        approvalRequiredAbove: 1000,
        termsCurrencyCode: null,
        cartCurrencyCode: 'USD',
        goodsGrossAmount: 1,
      }),
    ).toBe(true)
  })

  it('is false at exactly the threshold (D-R5-3: only a HIGHER total invalidates)', () => {
    expect(
      computeRequiresApproval({
        approvalRequiredAbove: 100,
        termsCurrencyCode: 'USD',
        cartCurrencyCode: 'USD',
        goodsGrossAmount: 100,
      }),
    ).toBe(false)
  })

  it('is true strictly above the threshold, with a matching currency', () => {
    expect(
      computeRequiresApproval({
        approvalRequiredAbove: 100,
        termsCurrencyCode: 'USD',
        cartCurrencyCode: 'USD',
        goodsGrossAmount: 100.01,
      }),
    ).toBe(true)
  })
})

describe('tryResolveCustomerGroupsService', () => {
  it('returns the resolved service when the DI container has it', () => {
    const service = { resolveTerms: jest.fn() } as any
    const container = { resolve: () => service }
    expect(tryResolveCustomerGroupsService(container)).toBe(service)
  })

  it('returns null, never throws, when the container cannot resolve it', () => {
    const container = {
      resolve: () => {
        throw new Error('Unexpected DI token: customerGroupsService')
      },
    }
    expect(tryResolveCustomerGroupsService(container)).toBeNull()
  })
})

describe('resolveCartRequiresApproval', () => {
  const baseCart = { tenantId: 'tenant-1', organizationId: 'org-1', customerId: 'cust-1', customerIds: ['cust-1'], currencyCode: 'USD' }

  it('degrades to false, never throws, when customerGroupsService cannot be resolved (customer_groups absent)', async () => {
    const container = {
      resolve: () => {
        throw new Error('Unexpected DI token: customerGroupsService')
      },
    }
    await expect(resolveCartRequiresApproval(container, baseCart, 1_000_000)).resolves.toBe(false)
  })

  it('delegates to resolveTerms, passing organizationId for the D-R5-37 base-currency fallback, and applies §9a.2', async () => {
    const resolveTerms = jest.fn(async () => ({
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: 100,
      minOrderValue: null,
      approvalPolicy: 'buyer' as const,
      termsCurrencyCode: 'USD',
      sources: {
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: null,
        approvalRequiredAbove: null,
        minOrderValue: null,
        approvalPolicy: null,
        termsCurrencyCode: null,
      },
    }))
    const container = { resolve: () => ({ resolveTerms }) }

    const result = await resolveCartRequiresApproval(container, baseCart, 150)

    expect(result).toBe(true)
    expect(resolveTerms).toHaveBeenCalledWith({
      customerId: 'cust-1',
      customerIds: ['cust-1'],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
