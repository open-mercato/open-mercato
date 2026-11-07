jest.mock('../cartLinesPeer', () => ({
  lookupCartLinePeers: jest.fn(),
}))
jest.mock('../cartPeer', () => ({
  lookupCartPeerById: jest.fn(),
}))

import { evaluateDeliveryDiscount } from '../promotionsDeliveryEvaluation'
import { lookupCartLinePeers } from '../cartLinesPeer'
import { lookupCartPeerById } from '../cartPeer'

const mockLookupCartLinePeers = lookupCartLinePeers as jest.Mock
const mockLookupCartPeerById = lookupCartPeerById as jest.Mock

const BASE_INPUT = {
  sessionId: 'session-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  cartId: 'cart-1',
  currencyCode: 'USD',
  deliveryMethodCode: 'carrier:express',
  deliveryCost: '9.99',
}

function makeContainer(promotionsService: unknown) {
  return {
    resolve: (name: string) => {
      if (name === 'promotionsService') {
        if (!promotionsService) throw new Error('promotionsService is not registered')
        return promotionsService
      }
      throw new Error(`Unexpected DI token: ${name}`)
    },
    register: jest.fn(),
  }
}

describe('evaluateDeliveryDiscount (C8/D-R5-17)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLookupCartPeerById.mockResolvedValue({
      id: 'cart-1',
      customerId: null,
      customerIds: [],
      customerGroupIds: [],
    })
    mockLookupCartLinePeers.mockResolvedValue([])
  })

  it('returns null — never throws — when promotions is absent (C10/D-R5-18)', async () => {
    const container = makeContainer(null)
    const em = {} as any

    const result = await evaluateDeliveryDiscount(container, em, BASE_INPUT)

    expect(result).toBeNull()
  })

  it('registers auth scope before calling evaluate, mirroring cart.reprice', async () => {
    const evaluate = jest.fn().mockResolvedValue({ appliedPromotions: [] })
    const container = makeContainer({ evaluate })

    await evaluateDeliveryDiscount(container, {} as any, BASE_INPUT)

    expect(container.register).toHaveBeenCalledTimes(1)
    const registered = container.register.mock.calls[0][0] as { auth: { resolve: () => unknown } }
    expect(registered.auth.resolve()).toEqual({ tenantId: 'tenant-1', orgId: 'org-1' })
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryMethodCode: 'carrier:express',
        deliveryCost: '9.99',
        currency: 'USD',
      }),
    )
  })

  it('surfaces the DELIVERY_DISCOUNT effect when the engine returns one', async () => {
    const evaluate = jest.fn().mockResolvedValue({
      appliedPromotions: [
        {
          promotionId: 'promo-1',
          promotionName: 'Free shipping',
          effects: [
            {
              type: 'DELIVERY_DISCOUNT',
              deliveryMethodCode: 'carrier:express',
              amountNet: '-9.99',
              amountGross: '-9.99',
              appliesTo: 'order',
              currency: 'USD',
              label: {},
              basis: 'gross',
            },
          ],
        },
      ],
    })
    const container = makeContainer({ evaluate })

    const result = await evaluateDeliveryDiscount(container, {} as any, BASE_INPUT)

    expect(result).toEqual({
      promotionId: 'promo-1',
      promotionName: 'Free shipping',
      deliveryMethodCode: 'carrier:express',
      amountNet: '-9.99',
      amountGross: '-9.99',
    })
  })

  it('returns null when no applied promotion carries a DELIVERY_DISCOUNT effect', async () => {
    const evaluate = jest.fn().mockResolvedValue({
      appliedPromotions: [
        {
          promotionId: 'promo-2',
          promotionName: 'Line discount',
          effects: [{ type: 'LINE_DISCOUNT', targetLineId: 'l1', targetProductId: 'p1', targetVariantId: null, lineQuantity: 1, appliedQuantity: 1, amountNet: '-1', amountGross: '-1', appliesTo: 'line', currency: 'USD', label: {}, basis: 'gross' }],
        },
      ],
    })
    const container = makeContainer({ evaluate })

    const result = await evaluateDeliveryDiscount(container, {} as any, BASE_INPUT)

    expect(result).toBeNull()
  })

  it('returns null (no throw) when evaluate() itself fails', async () => {
    const evaluate = jest.fn().mockRejectedValue(new Error('boom'))
    const container = makeContainer({ evaluate })

    const result = await evaluateDeliveryDiscount(container, {} as any, BASE_INPUT)

    expect(result).toBeNull()
  })

  it('returns null without calling evaluate when the cart cannot be found', async () => {
    mockLookupCartPeerById.mockResolvedValue(null)
    const evaluate = jest.fn()
    const container = makeContainer({ evaluate })

    const result = await evaluateDeliveryDiscount(container, {} as any, BASE_INPUT)

    expect(result).toBeNull()
    expect(evaluate).not.toHaveBeenCalled()
  })
})
