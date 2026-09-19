import { expect, test } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  numeric,
  readDocument,
  restoreDefaultTaxProvider,
  setTaxProvider,
  type JsonMap,
} from './helpers/taxProvider'

/**
 * TC-SALES-TAX-003 — Acceptance 3 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * The property this proves is the one that matters most operationally: a
 * provider failure NEVER fails the write and NEVER produces a silent zero. The
 * document saves, the amounts fall back to the engine's own table rate figures,
 * and the reason is recorded where the detail page and an alert can both read
 * it.
 *
 * It then clears the simulated failure and recalculates, proving the merchant
 * can recover without editing the document.
 */
test.describe('TC-SALES-TAX-003: a provider failure degrades to an estimate, never to a failed write', () => {
  test('a throw and a timeout both fall back, and a recalculation recovers', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      await setTaxProvider(request, token, {
        providerKey: 'fixed-rate',
        providerSettings: { rate: 5, simulateFailure: 'throw' },
      })

      orderId = await createSalesOrderFixture(request, token)
      await createOrderLineFixture(request, token, orderId, {
        name: `TC-SALES-TAX-003 line ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })

      // 1. The write succeeded and the amounts are the engine's own table rate
      //    figures, not zero and not the provider's 5%.
      let order = await readDocument(request, token, '/api/sales/orders', orderId)
      expect(order.taxStatus).toBe('fallback')
      expect(numeric(order.taxTotalAmount)).toBeCloseTo(20, 4)
      expect((order.taxInfo as JsonMap).failure).toMatchObject({ code: 'provider_error' })

      // 2. A timeout produces the same fallback with its own code.
      await setTaxProvider(request, token, {
        providerKey: 'fixed-rate',
        providerSettings: { rate: 5, simulateFailure: 'timeout' },
        timeoutMs: 1000,
      })
      const recalcTimeout = await apiRequest(request, 'POST', '/api/sales/documents/recalculate-tax', {
        token,
        retryTransport: false,
        data: { documentId: orderId, documentKind: 'order' },
      })
      expect(recalcTimeout.ok(), 'a timing out provider must not fail the request').toBeTruthy()

      order = await readDocument(request, token, '/api/sales/orders', orderId)
      expect(order.taxStatus).toBe('fallback')
      expect(numeric(order.taxTotalAmount)).toBeCloseTo(20, 4)
      expect((order.taxInfo as JsonMap).failure).toMatchObject({ code: 'timeout' })

      // 3. Clearing the simulated failure and recalculating recovers, without
      //    touching a single line or header field.
      await setTaxProvider(request, token, {
        providerKey: 'fixed-rate',
        providerSettings: { rate: 5, simulateFailure: 'none' },
      })
      const recalcOk = await apiRequest(request, 'POST', '/api/sales/documents/recalculate-tax', {
        token,
        retryTransport: false,
        data: { documentId: orderId, documentKind: 'order' },
      })
      expect(recalcOk.ok()).toBeTruthy()

      order = await readDocument(request, token, '/api/sales/orders', orderId)
      expect(order.taxStatus).toBe('calculated')
      expect(numeric(order.taxTotalAmount)).toBeCloseTo(5, 4)
      expect((order.taxInfo as JsonMap).failure ?? null).toBeNull()
    } finally {
      await restoreDefaultTaxProvider(request, token)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
