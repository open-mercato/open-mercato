import { expect, test } from '@playwright/test'
import { randomUUID } from 'crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function readId(payload: unknown): string | null {
  const direct = asRecord(payload).id
  if (typeof direct === 'string' && direct.length > 0) return direct
  const nested = asRecord(asRecord(payload).result).id
  if (typeof nested === 'string' && nested.length > 0) return nested
  return null
}

/**
 * TC-INT-007: WMS API inventory flow
 * Source: .ai/specs/SPEC-031-2026-02-20-wms-module.md
 */
test.describe('TC-INT-007: WMS API inventory flow', () => {
  test('should create warehouse/location and execute adjust/reserve/release flow', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const suffix = Date.now()
    const warehouseCode = `WMS-${suffix}`
    const catalogVariantId = randomUUID()
    const sourceId = randomUUID()

    let warehouseId: string | null = null
    let locationId: string | null = null

    try {
      const createWarehouseResponse = await apiRequest(request, 'POST', '/api/wms/warehouses', {
        token,
        data: {
          name: `Warehouse ${suffix}`,
          code: warehouseCode,
          is_active: true,
        },
      })
      expect(createWarehouseResponse.ok()).toBeTruthy()
      const createWarehouseBody = asRecord(await createWarehouseResponse.json())
      warehouseId = readId(createWarehouseBody)
      expect(warehouseId).toBeTruthy()

      const createLocationResponse = await apiRequest(request, 'POST', '/api/wms/locations', {
        token,
        data: {
          warehouse_id: warehouseId,
          code: `BIN-${suffix}`,
          type: 'bin',
          is_active: true,
        },
      })
      expect(createLocationResponse.ok()).toBeTruthy()
      const createLocationBody = asRecord(await createLocationResponse.json())
      locationId = readId(createLocationBody)
      expect(locationId).toBeTruthy()

      const adjustResponse = await apiRequest(request, 'POST', '/api/wms/inventory/adjust', {
        token,
        data: {
          warehouse_id: warehouseId,
          location_id: locationId,
          catalog_variant_id: catalogVariantId,
          quantity_delta: 10,
          reason: 'integration-test-adjust',
        },
      })
      expect(adjustResponse.ok()).toBeTruthy()
      const adjustBody = asRecord(await adjustResponse.json())
      const adjustedOnHand = asRecord(adjustBody.result).quantity_on_hand
      expect(adjustedOnHand).toBe(10)

      const reserveResponse = await apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
        token,
        data: {
          warehouse_id: warehouseId,
          catalog_variant_id: catalogVariantId,
          quantity: 4,
          source_type: 'manual',
          source_id: sourceId,
        },
      })
      expect(reserveResponse.ok()).toBeTruthy()
      const reserveBody = asRecord(await reserveResponse.json())
      const reservationId = asRecord(reserveBody.result).reservation_id
      expect(typeof reservationId).toBe('string')

      const releaseResponse = await apiRequest(request, 'POST', '/api/wms/inventory/release', {
        token,
        data: { reservation_id: reservationId },
      })
      expect(releaseResponse.ok()).toBeTruthy()
      const releaseBody = asRecord(await releaseResponse.json())
      expect(asRecord(releaseBody.result).status).toBe('released')

      const balancesResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/inventory/balances?warehouseId=${warehouseId}&locationId=${locationId}&catalogVariantId=${catalogVariantId}`,
        { token }
      )
      expect(balancesResponse.ok()).toBeTruthy()
      const balancesBody = asRecord(await balancesResponse.json())
      const items = Array.isArray(balancesBody.items) ? balancesBody.items : []
      expect(items.length).toBeGreaterThan(0)

      const first = asRecord(items[0])
      expect(first.quantityOnHand).toBe(10)
      expect(first.quantityReserved).toBe(0)
    } finally {
      if (locationId) {
        await apiRequest(request, 'DELETE', `/api/wms/locations/${locationId}`, { token })
      }
      if (warehouseId) {
        await apiRequest(request, 'DELETE', `/api/wms/warehouses/${warehouseId}`, { token })
      }
    }
  })
})
