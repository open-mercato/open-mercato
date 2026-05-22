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

import { UniqueConstraintViolationException } from '@mikro-orm/core'
import onGatewayInvoicePaid from '../subscribers/on-gateway-invoice-paid'
import onGatewayInvoiceFailed from '../subscribers/on-gateway-invoice-failed'
import { emitSubscriptionsEvent } from '../events'
import { loadSubscription, parseEventTimestamp } from '../subscribers/shared'

jest.mock('../events', () => ({
  emitSubscriptionsEvent: jest.fn(),
}))

jest.mock('../subscribers/shared', () => ({
  loadSubscription: jest.fn(),
  parseEventTimestamp: jest.fn(),
}))

const mockedEmitSubscriptionsEvent = emitSubscriptionsEvent as jest.Mock
const mockedLoadSubscription = loadSubscription as jest.Mock
const mockedParseEventTimestamp = parseEventTimestamp as jest.Mock

function createEntityManagerStub() {
  return {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn(),
    flush: jest.fn(),
    clear: jest.fn(),
  }
}

function createPayload() {
  return {
    providerKey: 'stripe',
    organizationId: 'o1',
    tenantId: 't1',
    externalAccountId: 'acct_1',
    subscriptionId: 'sub_local_1',
    providerSubscriptionId: 'sub_provider_1',
    providerCustomerId: 'cus_1',
    providerInvoiceId: 'in_1',
    providerChargeId: 'ch_1',
    providerEventType: 'invoice.paid',
    providerEventId: 'evt_1',
    providerEventCreatedAt: '2026-05-22T10:00:00.000Z',
    data: {
      id: 'in_1',
      currency: 'usd',
      amount_paid: 1900,
      amount_due: 1900,
    },
  }
}

describe('subscription billing subscribers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedParseEventTimestamp.mockReturnValue(new Date('2026-05-22T10:00:00.000Z'))
  })

  it('re-loads the subscription after duplicate invoice.paid billing record dedupe and still restores access', async () => {
    const em = createEntityManagerStub()
    const duplicateError = Object.create(UniqueConstraintViolationException.prototype)
    em.flush
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce(undefined)

    const firstLoad = {
      id: 'sub_local_1',
      externalAccountId: 'acct_1',
      accessState: 'grace',
      providerStatus: 'past_due',
      price: { currencyCode: 'USD' },
    }
    const secondLoad = {
      ...firstLoad,
    }
    mockedLoadSubscription
      .mockResolvedValueOnce(firstLoad)
      .mockResolvedValueOnce(secondLoad)

    await onGatewayInvoicePaid(createPayload(), {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`Unexpected resolve(${name})`)
      },
    })

    expect(em.clear).toHaveBeenCalledTimes(1)
    expect(mockedLoadSubscription).toHaveBeenCalledTimes(2)
    expect(secondLoad.accessState).toBe('granted')
    expect(mockedEmitSubscriptionsEvent).toHaveBeenCalledWith(
      'subscriptions.access.changed',
      expect.objectContaining({
        subscriptionId: 'sub_local_1',
        accessState: 'granted',
        previousAccessState: 'grace',
      }),
    )
  })

  it('re-loads the subscription after duplicate invoice.payment_failed billing record dedupe and still moves access to grace', async () => {
    const em = createEntityManagerStub()
    const duplicateError = Object.create(UniqueConstraintViolationException.prototype)
    em.flush
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce(undefined)

    const firstLoad = {
      id: 'sub_local_1',
      externalAccountId: 'acct_1',
      accessState: 'granted',
      providerStatus: 'active',
      price: { currencyCode: 'USD' },
    }
    const secondLoad = {
      ...firstLoad,
    }
    mockedLoadSubscription
      .mockResolvedValueOnce(firstLoad)
      .mockResolvedValueOnce(secondLoad)

    await onGatewayInvoiceFailed(
      {
        ...createPayload(),
        providerEventType: 'invoice.payment_failed',
        data: {
          id: 'in_1',
          currency: 'usd',
          amount_due: 1900,
        },
      },
      {
        resolve: (name: string) => {
          if (name === 'em') return em
          throw new Error(`Unexpected resolve(${name})`)
        },
      },
    )

    expect(em.clear).toHaveBeenCalledTimes(1)
    expect(mockedLoadSubscription).toHaveBeenCalledTimes(2)
    expect(secondLoad.accessState).toBe('grace')
    expect(mockedEmitSubscriptionsEvent).toHaveBeenCalledWith(
      'subscriptions.access.changed',
      expect.objectContaining({
        subscriptionId: 'sub_local_1',
        accessState: 'grace',
        previousAccessState: 'granted',
      }),
    )
  })
})
