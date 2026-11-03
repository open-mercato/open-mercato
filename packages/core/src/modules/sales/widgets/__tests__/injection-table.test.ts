/**
 * @jest-environment node
 */
import { DataTableInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { extensionPoints } from '../../extension-points'
import gatewayStatusColumnWidget from '../injection/payment-gateway-status-column/widget'

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

describe('sales gateway status column widget gating', () => {
  it('is hidden from users without the payment_gateways.view feature', () => {
    // `useInjectionDataWidgets` filters loaded widgets through `hasAllFeatures`,
    // and an empty `features` array means "show to everyone" — so the gate only
    // exists if the widget declares it.
    const features = gatewayStatusColumnWidget.metadata.features ?? []

    expect(features).toContain('payment_gateways.view')
    expect(hasAllFeatures(['sales.view'], features)).toBe(false)
    expect(hasAllFeatures(['payment_gateways.view'], features)).toBe(true)
    expect(hasAllFeatures(['payment_gateways.*'], features)).toBe(true)
  })

  it('is not loaded at all when the payment_gateways module is disabled', () => {
    // Both the header key and every value the column can show come from
    // `payment_gateways`; the injection loader skips the widget when a module it
    // declares here is absent from the enabled set.
    expect(gatewayStatusColumnWidget.metadata.requiredModules).toContain('payment_gateways')
  })
})
