import { expect, test } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  numeric,
  readDocument,
  restoreDefaultTaxProvider,
  setTaxProvider,
  type JsonMap,
} from './helpers/taxProvider'

/**
 * TC-SALES-TAX-002 — Acceptance 2 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * A selected provider replaces the engine's table rate math entirely. With
 * `fixed-rate` at 5% state plus 2% city, every line is taxed at 7% regardless of
 * the rate stored on it, and the document level breakdown holds exactly the two
 * jurisdictions the provider reported.
 *
 * The selection is per organization, so the finally block restores the default:
 * leaving it set would silently change the next spec's expectations.
 */
test.describe('TC-SALES-TAX-002: a selected provider replaces the table rate math', () => {
  test('fixed-rate taxes every line at its own rates and reports two jurisdictions', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null

    try {
      await setTaxProvider(request, token, {
        providerKey: 'fixed-rate',
        providerSettings: {
          rate: 5,
          jurisdictionName: 'State',
          secondaryRate: 2,
          secondaryJurisdictionName: 'City',
        },
      })

      orderId = await createSalesOrderFixture(request, token)
      // A line carrying a 20% table rate: the provider must override it.
      await createOrderLineFixture(request, token, orderId, {
        name: `TC-SALES-TAX-002 line ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })

      const order = await readDocument(request, token, '/api/sales/orders', orderId)

      expect(order.taxStrategyKey).toBe('fixed-rate')
      expect(order.taxStatus).toBe('calculated')
      // 7% of 100, not the 20% the line carries.
      expect(numeric(order.taxTotalAmount)).toBeCloseTo(7, 4)

      const taxInfo = order.taxInfo as JsonMap
      expect(taxInfo).toBeTruthy()
      const breakdown = (taxInfo.breakdown ?? []) as JsonMap[]
      expect(breakdown).toHaveLength(2)
      expect(breakdown.map((row) => row.jurisdictionName).sort()).toEqual(['City', 'State'])
      expect(breakdown.reduce((sum, row) => sum + numeric(row.taxAmount), 0)).toBeCloseTo(7, 4)

      const lines = (taxInfo.lines ?? []) as JsonMap[]
      expect(lines).toHaveLength(1)
      expect((lines[0].details as JsonMap[]).length).toBe(2)
    } finally {
      await restoreDefaultTaxProvider(request, token)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
