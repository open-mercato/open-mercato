import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  readJsonSafe,
  ensureProductionEnabledToggle,
  uniqueUuid,
} from './helpers/production'

type StockListResponse = {
  items?: Array<{ id: string; productId: string; onHand: number; reserved: number; available: number }>
}

type ImportResponse = { imported: number; failed: number; errors: Array<{ row: number; error: string }> }

type MovementsResponse = {
  items?: Array<{ id: string; movementType: string; qty: number; reversesMovementId: string | null }>
}

/**
 * TC-PROD-005: Stock intake surfaces (task 2.2) — CSV import, on-hand
 * visibility, batch receipt, storno restoring the prior balance.
 *
 * Self-contained: uses `uniqueUuid()` fixture product ids (production APIs
 * never resolve `productId` against the catalog module — matches
 * TC-PROD-00{1..4}'s existing convention) so no catalog fixtures are needed.
 */
test.describe('TC-PROD-005: Stock intake (CSV import, receipt, storno)', () => {
  test('CSV import (2 valid rows + 1 broken row) reports per-row results and on-hand becomes visible; storno restores prior balance', async ({ request }) => {
    test.setTimeout(60_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    const productId = uniqueUuid()

    // --- CSV import: 2 valid rows (10 + 5 pcs) + 1 broken row (non-numeric qty) ---
    const csv = [
      'product_id,variant_id,qty,uom,batch_number,expires_at',
      `${productId},,10,pcs,,`,
      `${productId},,5,pcs,BATCH-CSV,`,
      `${productId},,not-a-number,pcs,,`,
    ].join('\n')

    const importResponse = await request.post('/api/production/stock/import', {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'text/csv' },
      data: csv,
    })
    expect(importResponse.status(), 'POST stock/import should return 200').toBe(200)
    const importBody = (await importResponse.json()) as ImportResponse
    expect(importBody.imported).toBe(2)
    expect(importBody.failed).toBe(1)
    expect(importBody.errors).toHaveLength(1)
    expect(importBody.errors[0].row).toBe(3) // 1-indexed data rows, header excluded; the broken row is the 3rd data row

    // --- On-hand visible after import (10 + 5 = 15) ---
    const stockAfterImportResponse = await apiRequest(
      request,
      'GET',
      `/api/production/stock?productId=${productId}`,
      { token: adminToken },
    )
    expect(stockAfterImportResponse.status()).toBe(200)
    const stockAfterImport = await readJsonSafe<StockListResponse>(stockAfterImportResponse)
    const stockItem = stockAfterImport?.items?.find((item) => item.productId === productId)
    expect(stockItem?.onHand).toBe(15)

    // --- Manual receipt with a batch (separate lot) ---
    const receiveResponse = await apiRequest(request, 'POST', '/api/production/stock/receipts', {
      token: adminToken,
      data: { productId, qty: 20, uom: 'pcs', batchNumber: 'BATCH-MANUAL' },
    })
    expect(receiveResponse.status(), 'POST stock/receipts should return 201').toBe(201)
    const receiveBody = await readJsonSafe<{ movementIds?: string[] }>(receiveResponse)
    const receiveMovementId = receiveBody?.movementIds?.[0]
    expect(typeof receiveMovementId).toBe('string')

    const batchesResponse = await apiRequest(
      request,
      'GET',
      `/api/production/stock/batches?productId=${productId}`,
      { token: adminToken },
    )
    expect(batchesResponse.status()).toBe(200)
    const batchesBody = await readJsonSafe<{ items?: Array<{ batchNumber: string; onHand: number }> }>(batchesResponse)
    const manualBatch = batchesBody?.items?.find((b) => b.batchNumber === 'BATCH-MANUAL')
    expect(manualBatch?.onHand).toBe(20)

    const stockAfterReceiveResponse = await apiRequest(
      request,
      'GET',
      `/api/production/stock?productId=${productId}`,
      { token: adminToken },
    )
    const stockAfterReceive = await readJsonSafe<StockListResponse>(stockAfterReceiveResponse)
    expect(stockAfterReceive?.items?.find((i) => i.productId === productId)?.onHand).toBe(35) // 15 + 20

    // --- Storno the manual receipt restores the prior balance ---
    const reverseResponse = await apiRequest(
      request,
      'POST',
      `/api/production/stock/movements/${receiveMovementId}/reverse`,
      { token: adminToken },
    )
    expect(reverseResponse.status(), 'POST movements/{id}/reverse should return 200').toBe(200)

    const stockAfterReverseResponse = await apiRequest(
      request,
      'GET',
      `/api/production/stock?productId=${productId}`,
      { token: adminToken },
    )
    const stockAfterReverse = await readJsonSafe<StockListResponse>(stockAfterReverseResponse)
    expect(stockAfterReverse?.items?.find((i) => i.productId === productId)?.onHand).toBe(15) // back to 15

    // Double storno is rejected (409)
    const doubleReverseResponse = await apiRequest(
      request,
      'POST',
      `/api/production/stock/movements/${receiveMovementId}/reverse`,
      { token: adminToken },
    )
    expect(doubleReverseResponse.status()).toBe(409)

    // Movements history includes the reversal, linked via reversesMovementId
    const movementsResponse = await apiRequest(
      request,
      'GET',
      `/api/production/stock/movements?productId=${productId}&pageSize=20`,
      { token: adminToken },
    )
    expect(movementsResponse.status()).toBe(200)
    const movementsBody = await readJsonSafe<MovementsResponse>(movementsResponse)
    const reversal = movementsBody?.items?.find((m) => m.reversesMovementId === receiveMovementId)
    expect(reversal).toBeTruthy()
    expect(reversal?.qty).toBe(-20)
  })
})
