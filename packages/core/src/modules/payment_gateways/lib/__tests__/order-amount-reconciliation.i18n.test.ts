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
