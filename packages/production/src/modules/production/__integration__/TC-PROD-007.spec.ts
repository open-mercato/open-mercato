import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  readJsonSafe,
  ensureProductionEnabledToggle,
  createWorkCenter,
  deleteWorkCenterIfExists,
  createBom,
  deleteBomIfExists,
  createRouting,
  deleteRoutingIfExists,
  createProductionOrder,
  deleteProductionOrderIfExists,
  uniqueUuid,
} from './helpers/production'

type ReleaseResponse = {
  ok?: boolean
  reservations?: number
  shortages?: Array<{ componentProductId?: string; reason?: string; qtyShort?: number }>
}

type OrdersListResponse = {
  items?: Array<{ id?: string; sourceType?: string; sourceId?: string }>
}

/**
 * TC-PROD-007: Production order shortage path (task 3.4) — releasing
 * against a component with no stock never blocks the release (spec §
 * Status machine: shortages are reported, not a hard error); the shortage
 * list surfaces `no_stock_item`, and the orders list still finds the order
 * by its `sourceType`/`sourceId` filter.
 *
 * Self-contained: creates its own work center, BOM (+activate), routing
 * (+activate), and production order via the API — no stock is ever
 * received for the BOM component, cleaning up fixtures in `finally`.
 */
test.describe('TC-PROD-007: Production order shortage path (no stock)', () => {
  test('release reports a no_stock_item shortage instead of blocking, and the order is still listed by source filter', async ({ request }) => {
    test.setTimeout(60_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    const productId = uniqueUuid()
    const componentProductId = uniqueUuid()
    const salesOrderId = uniqueUuid()

    let workCenterId: string | null = null
    let bomId: string | null = null
    let routingId: string | null = null
    let orderId: string | null = null

    try {
      workCenterId = await createWorkCenter(request, adminToken, { kind: 'machine' })

      const bom = await createBom(request, adminToken, {
        productId,
        status: 'active',
        items: [
          { componentProductId, qtyPerUnit: 3, uom: 'PCS', scrapFactor: 0, isPhantom: false },
        ],
      })
      bomId = bom.id

      const routing = await createRouting(
        request,
        adminToken,
        { productId, status: 'active' },
        workCenterId,
      )
      routingId = routing.id

      orderId = await createProductionOrder(request, adminToken, {
        productId,
        qtyPlanned: 4,
        uom: 'PCS',
        sourceType: 'sales_order',
        sourceId: salesOrderId,
      })

      await apiRequest(request, 'POST', `/api/production/orders/${orderId}/plan`, { token: adminToken })

      const releaseResponse = await apiRequest(request, 'POST', `/api/production/orders/${orderId}/release`, { token: adminToken })
      expect(releaseResponse.status(), 'release should succeed (200) even with a shortage').toBe(200)
      const releaseBody = await readJsonSafe<ReleaseResponse>(releaseResponse)
      expect(releaseBody?.ok).toBe(true)
      expect(releaseBody?.reservations ?? 0).toBe(0)
      const shortage = (releaseBody?.shortages ?? []).find((line) => line.componentProductId === componentProductId)
      expect(shortage, 'the un-stocked component should appear in the shortage list').toBeTruthy()
      expect(shortage?.reason).toBe('no_stock_item')
      expect(shortage?.qtyShort).toBe(3)

      // --- On-demand shortages recompute agrees with the release-time snapshot ---
      const shortagesResponse = await apiRequest(request, 'GET', `/api/production/orders/${orderId}/shortages`, { token: adminToken })
      expect(shortagesResponse.status()).toBe(200)
      const shortagesBody = await readJsonSafe<{ lines?: Array<{ componentProductId?: string; reason?: string }> }>(shortagesResponse)
      const recomputedLine = (shortagesBody?.lines ?? []).find((line) => line.componentProductId === componentProductId)
      expect(recomputedLine?.reason).toBe('no_stock_item')

      // --- List still finds the order via the sourceType/sourceId filter, status released ---
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/production/orders?sourceType=sales_order&sourceId=${salesOrderId}`,
        { token: adminToken },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJsonSafe<OrdersListResponse>(listResponse)
      expect((listBody?.items ?? []).some((item) => item.id === orderId)).toBe(true)
    } finally {
      await deleteProductionOrderIfExists(request, adminToken, orderId)
      await deleteRoutingIfExists(request, adminToken, routingId)
      await deleteBomIfExists(request, adminToken, bomId)
      await deleteWorkCenterIfExists(request, adminToken, workCenterId)
    }
  })
})
