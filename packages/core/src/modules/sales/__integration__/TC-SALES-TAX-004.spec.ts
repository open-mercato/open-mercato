import { expect, test } from '@playwright/test'
import {
  createSalesOrderFixture,
  createOrderLineFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  getTaxProviderSelection,
  numeric,
  readDocument,
  restoreDefaultTaxProvider,
  setTaxProvider,
} from './helpers/taxProvider'

/**
 * TC-SALES-TAX-004 — Acceptance 4 of .ai/specs/2026-09-19-pluggable-tax-providers.md.
 *
 * The selection is stored per organization, so selecting a provider must not
 * change any other organization's amounts. This spec proves the two halves that
 * can be proven deterministically against one instance:
 *
 *  1. A document written while `integration-test-rate` is selected takes its rate.
 *  2. Restoring the default immediately returns the next document to the
 *     engine's own table rate math — the same figures TC-SALES-TAX-001 pins.
 *
 * A genuinely cross-organization assertion needs a second organization the
 * caller can switch into; where the environment provides one, the same GET on
 * `/api/sales/settings/tax-provider` under that scope must report `table-rates`.
 */
test.describe('TC-SALES-TAX-004: the selection is scoped, not global', () => {
  test('a selection applies only while it is set and leaves the default untouched', async ({ request }) => {
    test.slow()

    const token = await getAuthToken(request, 'admin')
    let selectedOrderId: string | null = null
    let defaultOrderId: string | null = null

    try {
      // The organization starts on the built in default.
      const before = await getTaxProviderSelection(request, token)
      expect(before.providerKey).toBe('table-rates')

      await setTaxProvider(request, token, {
        providerKey: 'integration-test-rate',
        providerSettings: { rate: 5, jurisdictionName: 'State' },
      })

      selectedOrderId = await createSalesOrderFixture(request, token)
      await createOrderLineFixture(request, token, selectedOrderId, {
        name: `TC-SALES-TAX-004 selected ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      const selectedOrder = await readDocument(request, token, '/api/sales/orders', selectedOrderId)
      expect(selectedOrder.taxStrategyKey).toBe('integration-test-rate')
      expect(numeric(selectedOrder.taxTotalAmount)).toBeCloseTo(5, 4)

      // Restoring the default must take effect on the very next document.
      await restoreDefaultTaxProvider(request, token)
      const after = await getTaxProviderSelection(request, token)
      expect(after.providerKey).toBe('table-rates')

      defaultOrderId = await createSalesOrderFixture(request, token)
      await createOrderLineFixture(request, token, defaultOrderId, {
        name: `TC-SALES-TAX-004 default ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 120,
        taxRate: 20,
      })
      const defaultOrder = await readDocument(request, token, '/api/sales/orders', defaultOrderId)
      expect(defaultOrder.taxStrategyKey).toBe('table-rates')
      // The line's own 20%, exactly as before this spec existed.
      expect(numeric(defaultOrder.taxTotalAmount)).toBeCloseTo(20, 4)
    } finally {
      await restoreDefaultTaxProvider(request, token)
      if (selectedOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', selectedOrderId)
      if (defaultOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', defaultOrderId)
    }
  })
})
