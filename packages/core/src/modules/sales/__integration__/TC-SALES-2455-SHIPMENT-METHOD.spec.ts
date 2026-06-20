import { expect, test } from '@playwright/test'
import {
  createOrderLineFixture,
  createSalesOrderFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-SALES-2455-SHIPMENT-METHOD: editing a shipment's shipping method persists.
 *
 * Regression for the bug where changing a shipment's shipping method returned
 * 200 { ok: true } but reopened with the old method. updateShipmentCommand set
 * shipmentEntity.shippingMethodId and then ran findWithDecryption(SalesShipmentItem)
 * (the item-snapshot read) on the same EntityManager before the terminal flush —
 * under MikroORM v7 that interleaved read dropped the pending scalar changeset
 * (the #2453 / SPEC-018 lost-write class), so the method never persisted. The fix
 * flushes the shipment scalars before the item reads, inside the same transaction.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function createShippingMethod(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  label: string,
): Promise<string> {
  const stamp = `${Date.now()}-${Math.round(performance.now())}`
  const res = await apiRequest(request, 'POST', '/api/sales/shipping-methods', {
    token,
    data: {
      name: `${label} ${stamp}`,
      code: `qa-${label.toLowerCase()}-${stamp}`,
      isActive: true,
      currencyCode: 'USD',
      baseRateNet: '10.00',
      baseRateGross: '10.00',
    },
  })
  expect(res.ok(), `create shipping method failed: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { id?: string }
  expect(typeof body.id, 'shipping method id present').toBe('string')
  return body.id as string
}

async function readShipmentMethod(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  shipmentId: string,
): Promise<string | null> {
  const res = await request.fetch(resolveUrl('/api/sales/shipments?page=1&pageSize=50'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(res.status(), 'list shipments 200').toBe(200)
  const body = (await res.json()) as { items?: Array<Record<string, unknown>> }
  const row = (body.items ?? []).find((s) => s.id === shipmentId)
  expect(row, 'created shipment present in list').toBeTruthy()
  return (row?.shippingMethodId ?? row?.shipping_method_id ?? null) as string | null
}

test('TC-SALES-2455-SHIPMENT-METHOD: changing a shipment shipping method persists', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  let orderId: string | null = null
  let shipmentId: string | null = null

  try {
    const methodA = await createShippingMethod(request, token, 'MethodA')
    const methodB = await createShippingMethod(request, token, 'MethodB')

    orderId = await createSalesOrderFixture(request, token, 'USD')
    const orderLineId = await createOrderLineFixture(request, token, orderId, { quantity: 2 })

    const createShipment = await apiRequest(request, 'POST', '/api/sales/shipments', {
      token,
      data: {
        orderId,
        shipmentNumber: `SHIP-2455-${Date.now()}`,
        shippingMethodId: methodA,
        items: [{ orderLineId, quantity: 1 }],
      },
    })
    expect(createShipment.ok(), `create shipment failed: ${createShipment.status()}`).toBeTruthy()
    shipmentId = ((await createShipment.json()) as { id?: string }).id ?? null
    expect(typeof shipmentId, 'shipment id present').toBe('string')

    expect(await readShipmentMethod(request, token, shipmentId as string)).toBe(methodA)

    // Change ONLY the shipping method — the item-snapshot read used to drop this.
    const update = await request.fetch(resolveUrl('/api/sales/shipments'), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: shipmentId, shippingMethodId: methodB },
    })
    expect(update.status(), 'PUT shipment 200').toBe(200)

    expect(
      await readShipmentMethod(request, token, shipmentId as string),
      'shipping method change must persist (not revert to the old method)',
    ).toBe(methodB)
  } finally {
    if (shipmentId) {
      await apiRequest(request, 'DELETE', '/api/sales/shipments', { token, data: { id: shipmentId, orderId } }).catch(() => {})
    }
    if (orderId) {
      await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id: orderId } }).catch(() => {})
    }
  }
})
