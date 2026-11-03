import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  registerGatewayAdapter,
  clearGatewayAdapters,
  type GatewayAdapter,
  type PaymentOrderTotal,
  type PaymentOrderTotalResolver,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { createPaymentGatewayService } from '../gateway-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const PROVIDER_KEY = 'mock-session-amount'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'

const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function buildService(resolver?: PaymentOrderTotalResolver | null) {
  const createSession = jest.fn(async () => ({
    sessionId: 'sess_1',
    status: 'pending' as UnifiedPaymentStatus,
  }))
  const adapter: GatewayAdapter = {
    providerKey: PROVIDER_KEY,
    createSession: createSession as never,
    capture: jest.fn(),
    refund: jest.fn(),
    cancel: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
    mapStatus: jest.fn(() => 'unknown' as UnifiedPaymentStatus),
  } as unknown as GatewayAdapter
  registerGatewayAdapter(adapter)

  const flush = jest.fn(async () => {})
  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'txn_1', ...data })),
    persist: jest.fn(() => ({ flush })),
    fork: jest.fn(() => em),
  }
  const integrationCredentialsService = { resolve: jest.fn(async () => ({})) } as never

  const service = createPaymentGatewayService({
    em: em as never,
    integrationCredentialsService,
    paymentOrderTotalResolver: resolver,
  })
  return { service, createSession, flush }
}

function makeResolver(total: PaymentOrderTotal | null) {
  return {
    resolveOrderTotal: jest.fn(async () => total),
  } satisfies PaymentOrderTotalResolver & { resolveOrderTotal: jest.Mock }
}

function sessionInput(overrides: Partial<Parameters<ReturnType<typeof createPaymentGatewayService>['createPaymentSession']>[0]> = {}) {
  return {
    providerKey: PROVIDER_KEY,
    paymentId: 'pay_1',
    orderId: ORDER_ID,
    amount: 100,
    currencyCode: 'EUR',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    ...overrides,
  }
}

const matchingTotal: PaymentOrderTotal = { orderId: ORDER_ID, currencyCode: 'EUR', amountDue: 100 }

describe('payment gateway service — session amount reconciliation (#4488)', () => {
  beforeAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  beforeEach(() => {
    clearGatewayAdapters()
  })

  afterEach(() => {
    clearGatewayAdapters()
  })

  it('creates the session when the amount matches the authoritative amount due', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    const result = await service.createPaymentSession(sessionInput())

    expect(resolver.resolveOrderTotal).toHaveBeenCalledWith(ORDER_ID, scope)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(result.transaction.amount).toBe('100')
  })

  it('accepts sub-cent rounding noise within the stored numeric precision', async () => {
    const resolver = makeResolver({ ...matchingTotal, amountDue: 100.00001 })
    const { service, createSession } = buildService(resolver)

    await service.createPaymentSession(sessionInput())

    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('rejects an amount lower than the amount due before calling the provider', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    await expect(service.createPaymentSession(sessionInput({ amount: 1 })))
      .rejects.toMatchObject({ status: 409 })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('rejects an amount higher than the amount due before calling the provider', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    await expect(service.createPaymentSession(sessionInput({ amount: 250 })))
      .rejects.toMatchObject({ status: 409 })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('rejects a currency that differs from the order currency', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    await expect(service.createPaymentSession(sessionInput({ currencyCode: 'USD' })))
      .rejects.toMatchObject({ status: 409 })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('ignores currency casing and padding when comparing', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    await service.createPaymentSession(sessionInput({ currencyCode: ' eur ' }))

    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('rejects an order the resolver cannot find, without revealing whether it exists elsewhere', async () => {
    const resolver = makeResolver(null)
    const { service, createSession } = buildService(resolver)

    await expect(service.createPaymentSession(sessionInput()))
      .rejects.toMatchObject({ status: 409, body: { error: `Order ${ORDER_ID} was not found in the current scope` } })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('rejects a cross-scope order with exactly the same response as a missing one', async () => {
    const crossScopeResolver: PaymentOrderTotalResolver = {
      resolveOrderTotal: jest.fn(async (orderId, requestScope) => (
        requestScope.tenantId === 'tenant_other' ? matchingTotal : null
      )),
    }
    const { service, createSession } = buildService(crossScopeResolver)

    await expect(service.createPaymentSession(sessionInput()))
      .rejects.toMatchObject({ status: 409, body: { error: `Order ${ORDER_ID} was not found in the current scope` } })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('skips reconciliation when the request references no order', async () => {
    const resolver = makeResolver(matchingTotal)
    const { service, createSession } = buildService(resolver)

    await service.createPaymentSession(sessionInput({ orderId: undefined, amount: 7 }))

    expect(resolver.resolveOrderTotal).not.toHaveBeenCalled()
    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('skips reconciliation when no module registered a resolver', async () => {
    const { service, createSession } = buildService(null)

    await service.createPaymentSession(sessionInput({ amount: 7 }))

    expect(createSession).toHaveBeenCalledTimes(1)
  })
})
