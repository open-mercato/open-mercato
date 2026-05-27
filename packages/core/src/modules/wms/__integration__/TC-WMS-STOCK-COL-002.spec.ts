import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createSalesQuoteFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales'],
}

type SalesQuoteListResponse = {
  items?: Array<Record<string, unknown>>
}

/**
 * TC-WMS-STOCK-COL-002: Quote detail → WMS column NOT visible
 * Quotes do not go through the WMS sales order enricher, so `_wms` should
 * not be present in the quote API response. The stock column widget only
 * renders when `ctx.kind === 'order'`, and no data fetch is triggered for quotes.
 */
test.describe('TC-WMS-STOCK-COL-002: WMS stock column — quote has no _wms enrichment', () => {
  test('should NOT include _wms data in the quotes API response', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      ['wms.view'],
    )

    let quoteId: string | null = null

    try {
      quoteId = await createSalesQuoteFixture(request, adminToken)

      const response = await apiRequest(
        request,
        'GET',
        `/api/sales/quotes?id=${encodeURIComponent(quoteId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(response.ok(), `GET /api/sales/quotes failed: ${response.status()}`).toBeTruthy()
      const body = await readJsonSafe<SalesQuoteListResponse>(response)
      const quote = body?.items?.[0]

      expect(quote, 'Expected quote in response').toBeTruthy()
      expect(
        (quote as Record<string, unknown>)?._wms,
        'Quotes should NOT have _wms enrichment — WMS stock column only applies to orders',
      ).toBeFalsy()
    } finally {
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/quotes', quoteId)
      await restoreAdminAcl()
    }
  })
})
