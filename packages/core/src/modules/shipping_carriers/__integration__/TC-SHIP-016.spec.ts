import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { defaultDestination, defaultOrigin, defaultPackage } from './helpers/fixtures'
import {
  countCarrierShipmentsByOrderInDb,
  deleteCarrierShipmentIdempotencyByKeyInDb,
  deleteCarrierShipmentInDb,
} from './helpers/db'

/**
 * TC-SHIP-016: Shipment create idempotency (SPEC-045c)
 *
 * The shipment-create endpoint must implement the idempotency contract: a
 * repeated POST with the same idempotency key returns the original shipment and
 * creates no duplicate, while reusing the key with a conflicting payload returns
 * the documented 409.
 */
function shipmentPayload(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    providerKey: 'mock_carrier',
    orderId,
    origin: defaultOrigin(),
    destination: defaultDestination(),
    packages: [defaultPackage()],
    serviceCode: 'standard',
    ...overrides,
  }
}

test.describe('TC-SHIP-016: Shipment create idempotency', () => {
  test('repeated POST with the same idempotency key returns the same shipment and creates no duplicate', async ({ request }) => {
    const token = await getAuthToken(request)
    const orderId = randomUUID()
    const idempotencyKey = `idem-${randomUUID()}`
    let shipmentId: string | null = null
    try {
      const first = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token,
        data: shipmentPayload(orderId, { idempotencyKey }),
      })
      expect(first.status()).toBe(201)
      const firstBody = await first.json()
      shipmentId = firstBody.shipmentId
      expect(shipmentId).toBeTruthy()

      const second = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token,
        data: shipmentPayload(orderId, { idempotencyKey }),
      })
      expect(second.status()).toBe(201)
      const secondBody = await second.json()
      expect(secondBody.shipmentId).toBe(shipmentId)

      expect(await countCarrierShipmentsByOrderInDb(orderId)).toBe(1)
    } finally {
      await deleteCarrierShipmentInDb(shipmentId)
      await deleteCarrierShipmentIdempotencyByKeyInDb(idempotencyKey)
    }
  })

  test('reusing the same idempotency key with a conflicting payload returns 409 and creates no second shipment', async ({ request }) => {
    const token = await getAuthToken(request)
    const orderId = randomUUID()
    const idempotencyKey = `idem-${randomUUID()}`
    let shipmentId: string | null = null
    try {
      const first = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token,
        data: shipmentPayload(orderId, { idempotencyKey, serviceCode: 'standard' }),
      })
      expect(first.status()).toBe(201)
      shipmentId = (await first.json()).shipmentId

      const conflict = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
        token,
        data: shipmentPayload(orderId, { idempotencyKey, serviceCode: 'express' }),
      })
      expect(conflict.status()).toBe(409)
      const conflictBody = await conflict.json()
      expect(conflictBody.code).toBe('idempotency_conflict')

      expect(await countCarrierShipmentsByOrderInDb(orderId)).toBe(1)
    } finally {
      await deleteCarrierShipmentInDb(shipmentId)
      await deleteCarrierShipmentIdempotencyByKeyInDb(idempotencyKey)
    }
  })

  test('distinct idempotency keys create independent shipments', async ({ request }) => {
    const token = await getAuthToken(request)
    const orderId = randomUUID()
    const keys = [`idem-${randomUUID()}`, `idem-${randomUUID()}`]
    const shipmentIds: string[] = []
    try {
      for (const idempotencyKey of keys) {
        const response = await apiRequest(request, 'POST', '/api/shipping-carriers/shipments', {
          token,
          data: shipmentPayload(orderId, { idempotencyKey }),
        })
        expect(response.status()).toBe(201)
        shipmentIds.push((await response.json()).shipmentId)
      }
      expect(shipmentIds[0]).not.toBe(shipmentIds[1])
      expect(await countCarrierShipmentsByOrderInDb(orderId)).toBe(2)
    } finally {
      for (const id of shipmentIds) await deleteCarrierShipmentInDb(id)
      for (const key of keys) await deleteCarrierShipmentIdempotencyByKeyInDb(key)
    }
  })
})
