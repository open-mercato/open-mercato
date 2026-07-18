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
  createCatalogProductWithDefaultUnit,
  createCatalogListPrice,
  createCatalogUnitConversion,
  deleteCatalogProductIfExists,
  uniqueName,
} from './helpers/production'

type CostRollupResponse = {
  bomId?: string
  quantity?: number
  materials?: number
  labor?: number
  total?: number
  perUnit?: number
  currency?: string | null
  priceBasis?: string
  missingPrices?: string[]
  missingConversions?: string[]
  mixedCurrency?: string[]
  missingRouting?: boolean
}

/**
 * TC-PROD-004: Standard cost rollup API (task 1.4).
 *
 * Self-contained: creates a real catalog product (defaultUnit `kg`) with a
 * catalog list price + a `g` -> `kg` unit conversion (materials/UoM side),
 * plus a second, deliberately unpriced catalog product (missingPrices
 * behavior), a work center (labor side), a BOM referencing both components
 * with a scrap factor + non-base UoM on the priced line, and a matching
 * routing version. Asserts the computed materials/labor/total/perUnit
 * numbers and that the unpriced component is collected into
 * `missingPrices` rather than silently treated as zero cost.
 */
test.describe('TC-PROD-004: Cost rollup API', () => {
  test('computes materials (scrap + UoM conversion) + labor, and surfaces a missing price', async ({ request }) => {
    test.setTimeout(60_000)

    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    await ensureProductionEnabledToggle(request, superadminToken)

    let workCenterId: string | null = null
    let bomId: string | null = null
    let routingId: string | null = null
    let pricedProductId: string | null = null
    let unpricedProductId: string | null = null

    try {
      // --- Materials side: a catalog product priced in kg, consumed in BOM as grams ---
      pricedProductId = await createCatalogProductWithDefaultUnit(request, adminToken, {
        title: uniqueName('QA Cost Rollup Priced Component'),
        defaultUnit: 'kg',
      })
      await createCatalogListPrice(request, adminToken, { productId: pricedProductId, unitPriceNet: 20 })
      await createCatalogUnitConversion(request, adminToken, {
        productId: pricedProductId,
        unitCode: 'g',
        toBaseFactor: 0.001,
      })

      // --- Missing-price component: real catalog product, deliberately no price ---
      unpricedProductId = await createCatalogProductWithDefaultUnit(request, adminToken, {
        title: uniqueName('QA Cost Rollup Unpriced Component'),
      })

      // --- Labor side: work center + routing operation ---
      workCenterId = await createWorkCenter(request, adminToken, {
        name: uniqueName('QA Cost Rollup Work Center'),
        costRatePerHour: 100,
      })

      const { id: createdBomId, productId: rootProductId } = await createBom(request, adminToken, {
        name: uniqueName('QA Cost Rollup BOM'),
        status: 'draft',
        items: [
          {
            componentProductId: pricedProductId,
            qtyPerUnit: 500,
            uom: 'g',
            scrapFactor: 0.1,
            isPhantom: false,
          },
          {
            componentProductId: unpricedProductId,
            qtyPerUnit: 1,
            uom: 'pc',
            scrapFactor: 0,
            isPhantom: false,
          },
        ],
      })
      bomId = createdBomId

      const bomDetailResponse = await apiRequest(request, 'GET', `/api/production/boms/${bomId}`, { token: adminToken })
      expect(bomDetailResponse.status()).toBe(200)
      const bomDetailBody = await readJsonSafe<{ version?: number }>(bomDetailResponse)
      const bomVersion = bomDetailBody?.version
      expect(typeof bomVersion === 'number').toBe(true)

      const { id: createdRoutingId } = await createRouting(
        request,
        adminToken,
        {
          productId: rootProductId,
          name: uniqueName('QA Cost Rollup Routing'),
          status: 'draft',
          operations: [
            {
              sequence: 10,
              name: 'Assemble',
              workCenterId,
              setupTimeMinutes: 6,
              runTimePerUnitSeconds: 120,
              isReportingPoint: true,
            },
          ],
        },
        workCenterId,
      )
      routingId = createdRoutingId
      // `createRouting` always assigns version 1 for a brand-new productId
      // (no prior routing exists for it), matching the BOM's own version-1
      // creation above — the cost-rollup route matches routing to BOM by
      // {productId, variantId, version}.
      expect(bomVersion).toBe(1)

      const rollupResponse = await apiRequest(
        request,
        'GET',
        `/api/production/boms/${bomId}/cost-rollup?quantity=2`,
        { token: adminToken },
      )
      expect(rollupResponse.status(), 'GET cost-rollup should return 200').toBe(200)
      const rollup = await readJsonSafe<CostRollupResponse>(rollupResponse)

      // Materials: qtyPerRootUnit = 500g * 1.1 (10% scrap) = 550g; for
      // quantity=2 -> 1100g -> 1.1kg; 1.1kg * $20/kg = $22.
      expect(rollup?.materials).toBeCloseTo(22, 6)
      // Labor: (6min setup + 120s * 2 qty / 60) = 6 + 4 = 10min = 1/6h; 1/6h * $100/h = $16.6667.
      expect(rollup?.labor).toBeCloseTo(16.6667, 3)
      expect(rollup?.total).toBeCloseTo(38.6667, 3)
      expect(rollup?.perUnit).toBeCloseTo(19.3333, 3)
      expect(rollup?.currency).toBe('USD')
      expect(rollup?.priceBasis).toBe('catalog_list_price')
      expect(rollup?.missingRouting).toBe(false)
      expect(rollup?.missingConversions ?? []).toEqual([])
      expect(rollup?.missingPrices).toContain(unpricedProductId)
    } finally {
      await deleteRoutingIfExists(request, adminToken, routingId)
      await deleteBomIfExists(request, adminToken, bomId)
      await deleteWorkCenterIfExists(request, adminToken, workCenterId)
      await deleteCatalogProductIfExists(request, adminToken, pricedProductId)
      await deleteCatalogProductIfExists(request, adminToken, unpricedProductId)
    }
  })
})
