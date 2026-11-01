const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEnforceCommandOptimisticLockWithGuards = jest.fn(async () => undefined)
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (...args: unknown[]) => mockEnforceCommandOptimisticLockWithGuards(...args),
}))

const mockLookupCartLinePeers = jest.fn(async () => [])
jest.mock('../../lib/cartLinesPeer', () => ({
  lookupCartLinePeers: (...args: unknown[]) => mockLookupCartLinePeers(...args),
}))

const mockGetOrComputeDeliveryOptions = jest.fn()
jest.mock('../../lib/deliveryRateCache', () => ({
  getOrComputeDeliveryOptions: (...args: unknown[]) => mockGetOrComputeDeliveryOptions(...args),
}))

const mockEvaluateDeliveryDiscount = jest.fn(async () => null)
jest.mock('../../lib/promotionsDeliveryEvaluation', () => ({
  evaluateDeliveryDiscount: (...args: unknown[]) => mockEvaluateDeliveryDiscount(...args),
}))

const mockWriteSessionEvent = jest.fn(async () => undefined)
jest.mock('../../lib/sessionEvents', () => ({
  writeSessionEvent: (...args: unknown[]) => mockWriteSessionEvent(...args),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { selectDeliveryCommand, type CheckoutSessionSelectDeliveryCommandInput } from '../delivery'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'session-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    status: 'open',
    cartId: 'cart-1',
    storeId: 'store-1',
    linkId: null,
    channel: 'storefront',
    currencyCode: 'USD',
    shippingAddress: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '5th Ave' },
    quotedTotals: null,
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeCtx(): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { flush: jest.fn(async () => undefined) }
        throw new Error(`Unexpected DI token: ${name}`)
      },
      register: jest.fn(),
    } as any,
    auth: null,
    selectedOrganizationId: null,
    organizationScope: null,
    organizationIds: null,
    request: undefined as any,
  }
}

const OPTION = {
  deliveryMethodCode: 'acme:express',
  providerKey: 'acme',
  serviceCode: 'express',
  label: 'Express',
  cost: '12.50',
  currencyCode: 'USD',
  estimatedDays: 2,
  source: 'carrier' as const,
}

describe('checkout.session.selectDelivery (B.3, §5.3/§5.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetOrComputeDeliveryOptions.mockResolvedValue([OPTION])
    mockEvaluateDeliveryDiscount.mockResolvedValue(null)
  })

  it('answers 404 when the session does not exist', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'missing',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'acme:express',
    }

    await expect(selectDeliveryCommand.execute(input, makeCtx())).rejects.toMatchObject({ status: 404 })
  })

  it('answers 409 session_not_open when the session is not open', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeSession({ status: 'submitting' }))
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'acme:express',
    }

    await expect(selectDeliveryCommand.execute(input, makeCtx())).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'session_not_open' }),
    })
  })

  it('answers 422 delivery_unavailable when the session has no shipping address yet', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeSession({ shippingAddress: null }))
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'acme:express',
    }

    await expect(selectDeliveryCommand.execute(input, makeCtx())).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'delivery_unavailable' }),
    })
  })

  it('answers 422 delivery_unavailable when the requested deliveryMethodCode is not among the recomputed options (never trusts the client)', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeSession())
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'does-not-exist',
    }

    await expect(selectDeliveryCommand.execute(input, makeCtx())).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ code: 'delivery_unavailable' }),
    })
  })

  it('snapshots the selected rate onto shippingMethod/quotedTotals and surfaces no discount when none applies', async () => {
    const session = makeSession()
    mockFindOneWithDecryption.mockResolvedValue(session)
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'acme:express',
    }

    const result = await selectDeliveryCommand.execute(input, makeCtx())

    expect(result.deliveryDiscount).toBeNull()
    expect(session.shippingMethod).toMatchObject({
      providerKey: 'acme',
      deliveryMethodCode: 'acme:express',
      price: '12.50',
      source: 'carrier',
    })
    expect(session.quotedTotals).toMatchObject({ deliveryMethodCode: 'acme:express', deliveryCost: '12.50', deliveryDiscount: null })
  })

  it('surfaces the delivery discount when the engine returns one', async () => {
    const session = makeSession()
    mockFindOneWithDecryption.mockResolvedValue(session)
    mockEvaluateDeliveryDiscount.mockResolvedValue({
      promotionId: 'promo-1',
      promotionName: 'Free shipping',
      deliveryMethodCode: 'acme:express',
      amountNet: '-12.50',
      amountGross: '-12.50',
    })
    const input: CheckoutSessionSelectDeliveryCommandInput = {
      sessionId: 'session-1',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deliveryMethodCode: 'acme:express',
    }

    const result = await selectDeliveryCommand.execute(input, makeCtx())

    expect(result.deliveryDiscount).toEqual({
      promotionId: 'promo-1',
      promotionName: 'Free shipping',
      amountNet: '-12.50',
      amountGross: '-12.50',
    })
    expect(session.quotedTotals).toMatchObject({ deliveryDiscount: '-12.50' })
  })
})
