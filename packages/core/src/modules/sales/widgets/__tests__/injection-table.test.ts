/**
 * @jest-environment node
 */
import { DataTableInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'
import { extensionPoints } from '../../extension-points'

describe('sales injection table', () => {
  it('binds the gateway status column to the spot the payments table actually resolves', async () => {
    const mod = await import('../injection-table')
    const table = mod.injectionTable

    // `PaymentsSection` passes `extensionPoints.hosts.paymentsTable.tableId` as
    // `extensionTableId`, and `DataTable` derives the columns spot from it. Spot
    // resolution is exact-match, so the binding key must be exactly this id —
    // anything else leaves the widget registered but unbound (issue #5142).
    const columnsSpotId = DataTableInjectionSpots.columns(
      extensionPoints.hosts.paymentsTable.tableId,
    )

    expect(columnsSpotId).toBe('data-table:sales.payments:columns')
    expect(table[columnsSpotId]).toEqual({
      widgetId: 'sales.injection.payment-gateway-status-column',
      priority: 50,
    })
  })
})
