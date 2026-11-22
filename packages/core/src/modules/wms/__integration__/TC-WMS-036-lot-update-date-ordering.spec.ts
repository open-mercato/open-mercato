import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type LotListResponse = {
  items?: Array<{ id?: string; manufactured_at?: string | null; best_before_at?: string | null; expires_at?: string | null }>
}

type ValidationErrorBody = {
  details?: Array<{ path?: Array<string | number> }>
}

test.describe('TC-WMS-036: Lot update keeps date ordering against the stored dates', () => {
  test('a single-date patch that conflicts with the stored dates is rejected and nothing changes', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_inventory',
    ])

    let productId: string | null = null
    let lotId: string | null = null

    const readLot = async () => {
      const response = await apiRequest(request, 'GET', `/api/wms/lots?ids=${lotId}&page=1&pageSize=1`, {
        token: adminToken,
      })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<LotListResponse>(response)
      return body?.items?.find((item) => item.id === lotId) ?? null
    }

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-036 Lot dates ${suffix}`,
        sku: `TCW36-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-036 Variant ${suffix}`,
        sku: `TCW36-V-${suffix}`,
      })
      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `TCW36-V-${suffix}`,
        lotNumber: `TCW36-L-${suffix}`,
        manufacturedAt: '2026-01-01T00:00:00.000Z',
        bestBeforeAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2026-12-01T00:00:00.000Z',
      })

      const rejected = await apiRequest(request, 'PUT', '/api/wms/lots', {
        token: adminToken,
        data: { id: lotId, expiresAt: '2025-01-01T00:00:00.000Z' },
      })
      expect(rejected.status()).toBe(400)
      const rejectedBody = await readJsonSafe<ValidationErrorBody>(rejected)
      expect(rejectedBody?.details?.some((issue) => issue.path?.[0] === 'expiresAt')).toBe(true)

      const unchanged = await readLot()
      expect(unchanged?.expires_at && new Date(unchanged.expires_at).toISOString()).toBe('2026-12-01T00:00:00.000Z')

      const accepted = await apiRequest(request, 'PUT', '/api/wms/lots', {
        token: adminToken,
        data: { id: lotId, expiresAt: '2026-09-01T00:00:00.000Z' },
      })
      expect(accepted.status()).toBe(200)

      const updated = await readLot()
      expect(updated?.expires_at && new Date(updated.expires_at).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
