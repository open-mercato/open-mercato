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

type ImportValidationResponse = {
  ok?: boolean
  rows?: Array<{
    status?: string
    errors?: string[]
    resolved?: { delta?: number }
  }>
}

test.describe('TC-WMS-035: Inventory CSV import rejects an unparseable quantity', () => {
  test('a quoted "1,000" quantity is a row error in both modes instead of a zero quantity', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
      'wms.view',
      'wms.manage_warehouses',
      'wms.manage_locations',
      'wms.import',
    ])

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-035 Import ${suffix}`,
        sku: `TCW35-P-${suffix}`,
      })
      await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-035 Variant ${suffix}`,
        sku: `TCW35-V-${suffix}`,
      })
      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-035 Warehouse ${suffix}`,
        code: `TCW35W${suffix}`,
        city: 'Krakow',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })
      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `BIN-${suffix}`,
        type: 'bin',
        isActive: true,
      })

      const csv = [
        'warehouse_code,location_code,sku,quantity',
        `TCW35W${suffix},BIN-${suffix},TCW35-V-${suffix},"1,000"`,
      ].join('\n')

      for (const mode of ['additive', 'reconcile'] as const) {
        const response = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            mode,
            csv,
          },
        })
        expect(response.ok(), `${mode} validate failed: ${response.status()}`).toBeTruthy()
        const validation = (await readJsonSafe<ImportValidationResponse>(response)) ?? {}
        expect(validation.ok, `${mode} validation should fail`).toBe(false)
        expect(validation.rows?.[0]?.status, `${mode} row status`).toBe('error')
        expect(validation.rows?.[0]?.errors, `${mode} row errors`).toEqual(['quantity_invalid'])
        expect(validation.rows?.[0]?.resolved, `${mode} row must not resolve a delta`).toBeUndefined()
      }
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
