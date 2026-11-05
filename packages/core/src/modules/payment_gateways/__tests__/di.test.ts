import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import {
  registerGatewayAdapter,
  clearGatewayAdapters,
  type GatewayAdapter,
  type PaymentOrderTotalResolver,
  type UnifiedPaymentStatus,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { register } from '../di'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

const PROVIDER_KEY = 'mock-di'
const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function buildContainer(orderTotalResolver?: unknown) {
  const createSession = jest.fn(async () => ({ sessionId: 'sess_1', status: 'pending' as UnifiedPaymentStatus }))
  registerGatewayAdapter({
    providerKey: PROVIDER_KEY,
    createSession: createSession as never,
    capture: jest.fn(),
    refund: jest.fn(),
    cancel: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhook: jest.fn(),
    mapStatus: jest.fn(() => 'unknown' as UnifiedPaymentStatus),
  } as unknown as GatewayAdapter)

  const em = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'txn_1', ...data })),
    persist: jest.fn(() => ({ flush: jest.fn(async () => {}) })),
    fork: jest.fn(() => em),
  }
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    integrationCredentialsService: asValue({ resolve: jest.fn(async () => ({})) }),
    integrationLogService: asValue(undefined),
    integrationStateService: asValue(undefined),
    ...(orderTotalResolver === undefined ? {} : { paymentOrderTotalResolver: asValue(orderTotalResolver) }),
  })
  register(container as unknown as AppContainer)
  return { container, createSession }
}

function sessionInput() {
  return {
    providerKey: PROVIDER_KEY,
    paymentId: 'pay_1',
    orderId: ORDER_ID,
    amount: 100,
    currencyCode: 'EUR',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }
}

describe('payment_gateways DI — order total resolver wiring (#4488)', () => {
  beforeAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  beforeEach(() => {
    clearGatewayAdapters()
  })

  afterEach(() => {
    clearGatewayAdapters()
  })

  it('reconciles session amounts when a module registered a resolver', async () => {
    const resolver: PaymentOrderTotalResolver = {
      resolveOrderTotal: jest.fn(async () => ({ orderId: ORDER_ID, currencyCode: 'EUR', amountDue: 250 })),
    }
    const { container, createSession } = buildContainer(resolver)
    const service = container.createScope().resolve('paymentGatewayService') as {
      createPaymentSession: (input: ReturnType<typeof sessionInput>) => Promise<unknown>
    }

    await expect(service.createPaymentSession(sessionInput())).rejects.toMatchObject({ status: 409 })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('creates sessions unreconciled when no module registered a resolver', async () => {
    const { container, createSession } = buildContainer()
    const service = container.createScope().resolve('paymentGatewayService') as {
      createPaymentSession: (input: ReturnType<typeof sessionInput>) => Promise<unknown>
    }

    await service.createPaymentSession(sessionInput())

    expect(createSession).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the registered resolver does not implement the contract', () => {
    const { container } = buildContainer({ notAResolver: true })

    expect(() => container.createScope().resolve('paymentGatewayService'))
      .toThrow(/resolveOrderTotal/)
  })
})
