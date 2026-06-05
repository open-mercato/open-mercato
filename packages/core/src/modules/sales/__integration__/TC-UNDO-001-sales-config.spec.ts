import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 sales config entities (#2575).
 *
 * Covers stable sales configuration CRUD commands through the public API.
 */
test.describe('TC-UNDO-001 sales config undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('channels CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'sales.channels',
      collectionPath: '/api/sales/channels',
      field: 'name',
      createPayload: (stamp) => ({
        name: `Undo Channel ${stamp}`,
        code: `undo_ch_${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo Channel Renamed ${stamp}`,
        code: `undo_ch_${stamp}`,
      }),
    })
  })

  test('shipping methods CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'sales.shippingMethods',
      collectionPath: '/api/sales/shipping-methods',
      field: 'name',
      createPayload: (stamp) => ({
        name: `Undo Shipping ${stamp}`,
        code: `undo_ship_${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo Shipping Renamed ${stamp}`,
      }),
    })
  })

  test('payment methods CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'sales.paymentMethods',
      collectionPath: '/api/sales/payment-methods',
      field: 'name',
      createPayload: (stamp) => ({
        name: `Undo Payment ${stamp}`,
        code: `undo_pay_${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo Payment Renamed ${stamp}`,
      }),
    })
  })

  test('tax rates CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    await runCrudUndoRoundTrip(request, token, {
      label: 'sales.taxRates',
      collectionPath: '/api/sales/tax-rates',
      field: 'name',
      createPayload: (stamp) => ({
        name: `Undo Tax ${stamp}`,
        code: `undo_tax_${stamp}`,
        rate: '7.5',
      }),
      updatePayload: (id, stamp) => ({
        id,
        name: `Undo Tax Renamed ${stamp}`,
      }),
    })
  })
})
