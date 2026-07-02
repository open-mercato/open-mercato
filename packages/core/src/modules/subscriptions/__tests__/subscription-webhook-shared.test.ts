jest.mock('@mikro-orm/decorators/legacy', () => {
  const decorator = () => () => undefined
  return {
    Entity: decorator,
    Index: decorator,
    ManyToOne: decorator,
    PrimaryKey: decorator,
    Property: decorator,
    Unique: decorator,
  }
}, { virtual: true })

import { ensureSubscriptionFromSnapshot } from '../subscribers/shared'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const { findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
}

function createEntityManagerStub() {
  return {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'sub_local_1', ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

describe('ensureSubscriptionFromSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a subscription using subject fields from the checkout mapping', async () => {
    const em = createEntityManagerStub()
    const price = {
      id: 'price_1',
      code: 'starter-monthly-v1',
      plan: { id: 'plan_1', code: 'starter', productCode: 'external-app' },
    }
    const mapping = {
      id: 'map_1',
      providerKey: 'stripe',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: null,
      organizationId: 'o1',
      tenantId: 't1',
      externalAccountId: 'acct_1',
      subjectEntityType: 'customers:customer_company_profile',
      subjectEntityId: '11111111-1111-1111-1111-111111111111',
    }

    findOneWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'Subscription') return null
      if (entityClass?.name === 'GatewaySubscriptionMapping') return mapping
      if (entityClass?.name === 'SubscriptionPrice') return price
      return null
    })

    const result = await ensureSubscriptionFromSnapshot(
      { em: em as never, credentialsService: {} as never },
      {
        providerKey: 'stripe',
        organizationId: 'o1',
        tenantId: 't1',
        externalAccountId: 'acct_1',
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerInvoiceId: null,
        providerChargeId: null,
        providerEventType: 'customer.subscription.created',
        providerEventId: 'evt_1',
        providerEventCreatedAt: new Date().toISOString(),
        data: {},
      },
      {
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerStatus: 'active',
        cancelAtPeriodEnd: false,
        priceCode: 'starter-monthly-v1',
      },
    )

    expect(result).not.toBeNull()
    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectEntityType: 'customers:customer_company_profile',
      subjectEntityId: '11111111-1111-1111-1111-111111111111',
      externalAccountId: 'acct_1',
    }))
  })

  it('prefers the webhook event timestamp over the fetched snapshot timestamp', async () => {
    const em = createEntityManagerStub()
    const price = {
      id: 'price_1',
      code: 'starter-monthly-v1',
      plan: { id: 'plan_1', code: 'starter', productCode: 'external-app' },
    }
    const mapping = {
      id: 'map_1',
      providerKey: 'stripe',
      providerCustomerId: 'cus_1',
      providerSubscriptionId: null,
      organizationId: 'o1',
      tenantId: 't1',
      externalAccountId: 'acct_1',
      subjectEntityType: 'customers:customer_company_profile',
      subjectEntityId: '11111111-1111-1111-1111-111111111111',
    }
    const eventCreatedAt = '2026-05-22T10:00:00.000Z'
    const snapshotFetchedAt = new Date('2026-05-22T10:05:00.000Z')

    findOneWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'Subscription') return null
      if (entityClass?.name === 'GatewaySubscriptionMapping') return mapping
      if (entityClass?.name === 'SubscriptionPrice') return price
      return null
    })

    await ensureSubscriptionFromSnapshot(
      { em: em as never, credentialsService: {} as never },
      {
        providerKey: 'stripe',
        organizationId: 'o1',
        tenantId: 't1',
        externalAccountId: 'acct_1',
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerInvoiceId: null,
        providerChargeId: null,
        providerEventType: 'customer.subscription.created',
        providerEventId: 'evt_1',
        providerEventCreatedAt: eventCreatedAt,
        data: {},
      },
      {
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerStatus: 'active',
        cancelAtPeriodEnd: false,
        priceCode: 'starter-monthly-v1',
        lastEventAt: snapshotFetchedAt,
      },
    )

    expect(em.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      lastProviderEventAt: new Date(eventCreatedAt),
    }))
  })

  it('refuses to create a subscription when no subject fields can be resolved', async () => {
    const em = createEntityManagerStub()
    const price = {
      id: 'price_1',
      code: 'starter-monthly-v1',
      plan: { id: 'plan_1', code: 'starter', productCode: 'external-app' },
    }

    findOneWithDecryption.mockImplementation(async (_em: unknown, entityClass: { name?: string }) => {
      if (entityClass?.name === 'Subscription') return null
      if (entityClass?.name === 'GatewaySubscriptionMapping') return null
      if (entityClass?.name === 'SubscriptionPrice') return price
      return null
    })

    const result = await ensureSubscriptionFromSnapshot(
      { em: em as never, credentialsService: {} as never },
      {
        providerKey: 'stripe',
        organizationId: 'o1',
        tenantId: 't1',
        externalAccountId: 'acct_1',
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerInvoiceId: null,
        providerChargeId: null,
        providerEventType: 'customer.subscription.created',
        providerEventId: 'evt_1',
        providerEventCreatedAt: new Date().toISOString(),
        data: {},
      },
      {
        providerSubscriptionId: 'sub_1',
        providerCustomerId: 'cus_1',
        providerStatus: 'active',
        cancelAtPeriodEnd: false,
        priceCode: 'starter-monthly-v1',
      },
    )

    expect(result).toBeNull()
    expect(em.create).not.toHaveBeenCalled()
  })
})
