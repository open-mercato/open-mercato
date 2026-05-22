import { syncSubscriptionPlans } from '../lib/plan-sync'
import type { SubscriptionPlanManifest } from '../plans'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const { findOneWithDecryption, findWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
  findWithDecryption: jest.Mock
}

function makeEmStub(): { em: any; created: any[] } {
  const created: any[] = []
  const em = {
    create: jest.fn((_entityClass: unknown, data: Record<string, unknown>) => {
      const entity = { ...data, id: `mock-${created.length + 1}` }
      created.push(entity)
      return entity
    }),
    persist: jest.fn(),
    nativeUpdate: jest.fn().mockResolvedValue(1),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  return { em, created }
}

const baseManifest: SubscriptionPlanManifest[] = [
  {
    code: 'starter',
    productCode: 'app',
    title: 'Starter',
    description: 'Basic',
    isActive: true,
    prices: [
      {
        code: 'starter-monthly-v1',
        providerKey: 'stripe',
        currencyCode: 'USD',
        interval: 'month',
        intervalCount: 1,
        unitAmountMinor: 1900,
        trialDays: 14,
        isDefault: true,
        isActive: true,
        stripe: {
          productLookupKey: 'app-starter',
          priceLookupKey: 'app-starter-monthly-v1',
          taxBehavior: 'exclusive',
        },
      },
    ],
  },
]

describe('syncSubscriptionPlans', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates new plan and price when none exist', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    findWithDecryption.mockResolvedValue([])
    const { em } = makeEmStub()
    const result = await syncSubscriptionPlans({
      em,
      scope: { tenantId: 't1', organizationId: 'o1' },
      manifest: baseManifest,
      runtime: null,
      credentials: null,
    })
    expect(result.plansUpserted).toBe(1)
    expect(result.pricesUpserted).toBe(1)
    expect(result.providerEnsured).toBe(0)
    expect(em.persist).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects economic mutation on existing price', async () => {
    const existingPlan = {
      id: 'plan-1',
      tenantId: 't1',
      organizationId: 'o1',
      code: 'starter',
      productCode: 'app',
      title: 'Starter',
      description: 'Basic',
      entitlementsJson: null,
      isActive: true,
    }
    const existingPrice = {
      id: 'price-1',
      tenantId: 't1',
      organizationId: 'o1',
      plan: existingPlan,
      code: 'starter-monthly-v1',
      providerKey: 'stripe',
      currencyCode: 'USD',
      interval: 'month',
      intervalCount: 1,
      unitAmountMinor: 1900,
      trialDays: 14,
      productLookupKey: 'app-starter',
      priceLookupKey: 'app-starter-monthly-v1',
      isDefault: true,
      isActive: true,
    }
    findOneWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'SubscriptionPlan') return existingPlan
      if (entityClass?.name === 'SubscriptionPrice') return existingPrice
      return null
    })
    findWithDecryption.mockResolvedValue([])

    const mutatedManifest: SubscriptionPlanManifest[] = [
      {
        ...baseManifest[0],
        prices: [
          {
            ...baseManifest[0].prices[0],
            unitAmountMinor: 2900,
          },
        ],
      },
    ]

    const { em } = makeEmStub()
    await expect(
      syncSubscriptionPlans({
        em,
        scope: { tenantId: 't1', organizationId: 'o1' },
        manifest: mutatedManifest,
        runtime: null,
        credentials: null,
      }),
    ).rejects.toThrow(/economic change on existing price code/)
  })

  it('persists provider refs onto an existing price when Stripe catalog sync returns them', async () => {
    const existingPlan = {
      id: 'plan-1',
      tenantId: 't1',
      organizationId: 'o1',
      code: 'starter',
      productCode: 'app',
      title: 'Starter',
      description: 'Basic',
      entitlementsJson: null,
      isActive: true,
    }
    const existingPrice = {
      id: 'price-1',
      tenantId: 't1',
      organizationId: 'o1',
      plan: existingPlan,
      code: 'starter-monthly-v1',
      providerKey: 'stripe',
      currencyCode: 'USD',
      interval: 'month',
      intervalCount: 1,
      unitAmountMinor: 1900,
      trialDays: 14,
      providerProductRef: null,
      providerPriceRef: null,
      productLookupKey: 'app-starter',
      priceLookupKey: 'app-starter-monthly-v1',
      isDefault: true,
      isActive: true,
    }
    findOneWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'SubscriptionPlan') return existingPlan
      if (entityClass?.name === 'SubscriptionPrice') return existingPrice
      return null
    })
    findWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'SubscriptionPlan') return [existingPlan]
      if (entityClass?.name === 'SubscriptionPrice') return [existingPrice]
      return []
    })

    const runtime = {
      ensureCatalog: jest.fn().mockResolvedValue({
        prices: [
          {
            priceCode: 'starter-monthly-v1',
            providerProductRef: 'prod_123',
            providerPriceRef: 'price_123',
          },
        ],
      }),
    }

    const { em } = makeEmStub()
    const result = await syncSubscriptionPlans({
      em,
      scope: { tenantId: 't1', organizationId: 'o1' },
      manifest: baseManifest,
      runtime: runtime as any,
      credentials: { secretKey: 'sk_test_123' },
    })

    expect(result.providerEnsured).toBe(1)
    expect(existingPrice.providerProductRef).toBe('prod_123')
    expect(existingPrice.providerPriceRef).toBe('price_123')
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'price-1', tenantId: 't1', organizationId: 'o1' },
      { providerProductRef: 'prod_123', providerPriceRef: 'price_123' },
    )
  })
})
