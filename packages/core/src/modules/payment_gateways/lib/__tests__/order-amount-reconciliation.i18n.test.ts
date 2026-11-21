import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { PaymentOrderTotal, PaymentOrderTotalResolver } from '@open-mercato/shared/modules/payment_gateways/types'
import plDictionary from '../../i18n/pl.json'
import { reconcileSessionAmountWithOrder } from '../order-amount-reconciliation'

const mockResolveTranslations = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const scope = { organizationId: 'org_1', tenantId: 'tenant_1' }

function makeResolver(total: PaymentOrderTotal | null): PaymentOrderTotalResolver {
  return { resolveOrderTotal: async () => total }
}

function reconcile(overrides: { amount?: number; currencyCode?: string; total?: PaymentOrderTotal | null } = {}) {
  const total = overrides.total === undefined
    ? { orderId: ORDER_ID, currencyCode: 'EUR', amountDue: 100 }
    : overrides.total
  return reconcileSessionAmountWithOrder({
    orderId: ORDER_ID,
    amount: overrides.amount ?? 100,
    currencyCode: overrides.currencyCode ?? 'EUR',
    scope,
    resolver: makeResolver(total),
  })
}

describe('session amount reconciliation — localized conflict messages (#4488)', () => {
  afterEach(() => {
    mockResolveTranslations.mockReset()
  })

  describe('with a request-scoped dictionary', () => {
    beforeEach(() => {
      mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(plDictionary) })
    })

    it('serves the unresolved-order conflict from the module catalog', async () => {
      await expect(reconcile({ total: null })).rejects.toMatchObject({
        status: 409,
        body: { error: `Nie znaleziono zamówienia ${ORDER_ID} w bieżącym zakresie` },
      })
    })

    it('serves the amount-mismatch conflict from the module catalog', async () => {
      await expect(reconcile({ amount: 150 })).rejects.toMatchObject({
        status: 409,
        body: { error: `Kwota sesji płatności 150 nie zgadza się z kwotą do zapłaty dla zamówienia ${ORDER_ID}` },
      })
    })

    it('serves the currency-mismatch conflict from the module catalog', async () => {
      await expect(reconcile({ currencyCode: 'usd' })).rejects.toMatchObject({
        status: 409,
        body: { error: `Waluta sesji płatności USD nie zgadza się z walutą zamówienia ${ORDER_ID}` },
      })
    })
  })

  describe('without a registered module dictionary', () => {
    beforeEach(() => {
      mockResolveTranslations.mockRejectedValue(new Error('[Bootstrap] Modules not registered.'))
    })

    it('still rejects, falling back to the English template', async () => {
      await expect(reconcile({ amount: 150 })).rejects.toMatchObject({
        status: 409,
        body: { error: `Payment session amount 150 does not match the amount due for order ${ORDER_ID}` },
      })
    })

    it('still rejects an order that does not resolve in scope', async () => {
      await expect(reconcile({ total: null })).rejects.toMatchObject({
        status: 409,
        body: { error: `Order ${ORDER_ID} was not found in the current scope` },
      })
    })
  })
})

describe('session amount reconciliation tolerance', () => {
  beforeEach(() => {
    mockResolveTranslations.mockRejectedValue(new Error('[Bootstrap] Modules not registered.'))
  })

  afterEach(() => {
    mockResolveTranslations.mockReset()
  })

  function reconcileExact(input: {
    amountExact: string
    total: PaymentOrderTotal
    currencyDecimalPlaces?: number | null
  }) {
    return reconcileSessionAmountWithOrder({
      orderId: ORDER_ID,
      amount: Number(input.amountExact),
      amountExact: input.amountExact,
      currencyCode: input.total.currencyCode,
      currencyDecimalPlaces: input.currencyDecimalPlaces,
      scope,
      resolver: makeResolver(input.total),
    })
  }

  it('keeps the 0.0001 tolerance when the resolver only reports a float amount due', async () => {
    const total = { orderId: ORDER_ID, currencyCode: 'USD', amountDue: 0.1 + 0.2 }
    await expect(reconcileExact({ amountExact: '0.3', total })).resolves.toBeUndefined()
    await expect(reconcileExact({ amountExact: '0.30009', total })).resolves.toBeUndefined()
    await expect(reconcileExact({ amountExact: '0.3002', total })).rejects.toMatchObject({ status: 409 })
  })

  it('uses the currency amount precision when the exact amount due is known', async () => {
    const total = { orderId: ORDER_ID, currencyCode: 'USD', amountDue: 100, amountDueExact: '100' }
    await expect(reconcileExact({ amountExact: '100.00005', total, currencyDecimalPlaces: 2 })).resolves.toBeUndefined()
    await expect(reconcileExact({ amountExact: '100.0002', total, currencyDecimalPlaces: 2 })).rejects.toMatchObject({ status: 409 })
  })

  it('narrows the tolerance for a higher-precision currency', async () => {
    const total = { orderId: ORDER_ID, currencyCode: 'BTC', amountDue: 1.5, amountDueExact: '1.5' }
    await expect(reconcileExact({ amountExact: '1.500000005', total, currencyDecimalPlaces: 8 })).resolves.toBeUndefined()
    await expect(reconcileExact({ amountExact: '1.49999999', total, currencyDecimalPlaces: 8 })).rejects.toMatchObject({ status: 409 })
    await expect(reconcileExact({ amountExact: '1.50000001', total, currencyDecimalPlaces: 8 })).rejects.toMatchObject({ status: 409 })
  })

  it('falls back to 4 decimals when the currency precision is unknown', async () => {
    const total = { orderId: ORDER_ID, currencyCode: 'USD', amountDue: 1.5, amountDueExact: '1.5' }
    await expect(reconcileExact({ amountExact: '1.50005', total, currencyDecimalPlaces: null })).resolves.toBeUndefined()
    await expect(reconcileExact({ amountExact: '1.5001', total, currencyDecimalPlaces: null })).rejects.toMatchObject({ status: 409 })
    await expect(reconcileExact({ amountExact: '1.5002', total })).rejects.toMatchObject({ status: 409 })
  })
})
