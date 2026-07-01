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
import {
  createCrudFixture,
  ensureRoleFeatures,
  fetchBalance,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type ImportValidationResponse = {
  ok?: boolean
  importBatchId?: string
  summary?: {
    totalRows?: number
    validRows?: number
    errorRows?: number
  }
  rows?: Array<{
    rowNumber?: number
    status?: string
    resolved?: {
      warehouseId?: string
      locationId?: string
      catalogVariantId?: string
      quantity?: number
      delta?: number
    }
  }>
}

type ImportApplyResponse = {
  ok?: boolean
  summary?: {
    applied?: number
    skipped?: number
    failed?: number
  }
}

test.describe('TC-WMS-025: Inventory CSV import API', () => {
  test('requires auth for template download', async ({ request }) => {
    const baseUrl = process.env.BASE_URL?.trim() || 'http://localhost:3000'
    const response = await request.get(`${baseUrl}/api/wms/inventory/import/template`)
    expect(response.status()).toBe(401)
  })

  test('denies import routes without wms.import feature', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee')
    const scope = getTokenScope(employeeToken)

    const validateResponse = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
      token: employeeToken,
      data: {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        rows: [{ warehouseCode: 'X', locationCode: 'Y', sku: 'Z', quantity: '1' }],
      },
    })
    expect(validateResponse.status()).toBe(403)

    const templateResponse = await apiRequest(request, 'GET', '/api/wms/inventory/import/template', {
      token: employeeToken,
    })
    expect(templateResponse.status()).toBe(403)
  })

  test('returns CSV template for authorized users', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/wms/inventory/import/template', {
      token: adminToken,
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.text()
    expect(body).toContain('warehouse_code,location_code,sku,quantity')
  })

  test('validates, applies import rows, and rejects tampered delta', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const suffix = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      superadminToken,
      scope.tenantId,
      'admin',
      [
        'wms.view',
        'wms.manage_warehouses',
        'wms.manage_locations',
        'wms.manage_inventory',
        'wms.adjust_inventory',
        'wms.import',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `TC-WMS-025 Import ${suffix}`,
        sku: `TCW25-P-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `TC-WMS-025 Variant ${suffix}`,
        sku: `TCW25-V-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `TC-WMS-025 Warehouse ${suffix}`,
        code: `TCW25W${suffix}`,
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

      const validateResponse = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          rows: [
            {
              warehouseCode: `TCW25W${suffix}`,
              locationCode: `BIN-${suffix}`,
              sku: `TCW25-V-${suffix}`,
              quantity: '25',
            },
          ],
        },
      })
      expect(validateResponse.ok(), `validate failed: ${validateResponse.status()}`).toBeTruthy()
      const validation = (await readJsonSafe<ImportValidationResponse>(validateResponse)) ?? {}
      expect(validation.ok).toBe(true)
      expect(validation.importBatchId).toBeTruthy()
      const resolved = validation.rows?.[0]?.resolved
      expect(resolved?.delta).toBe(25)

      const applyResponse = await apiRequest(request, 'POST', '/api/wms/inventory/import/apply', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          importBatchId: validation.importBatchId,
          continueOnError: true,
          rows: [
            {
              rowNumber: 1,
              warehouseId: resolved?.warehouseId,
              locationId: resolved?.locationId,
              catalogVariantId: resolved?.catalogVariantId,
              quantity: resolved?.quantity,
              delta: resolved?.delta,
            },
          ],
        },
      })
      expect(applyResponse.ok(), `apply failed: ${applyResponse.status()}`).toBeTruthy()
      const applyResult = (await readJsonSafe<ImportApplyResponse>(applyResponse)) ?? {}
      expect(applyResult.summary?.applied).toBe(1)

      const balance = await fetchBalance(request, adminToken, warehouseId!, variantId)
      expect(toNumber(balance?.quantity_on_hand)).toBe(25)

      const tamperedResponse = await apiRequest(request, 'POST', '/api/wms/inventory/import/apply', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          importBatchId: randomUUID(),
          continueOnError: true,
          rows: [
            {
              rowNumber: 1,
              warehouseId: resolved?.warehouseId,
              locationId: resolved?.locationId,
              catalogVariantId: resolved?.catalogVariantId,
              quantity: 25,
              delta: 999,
            },
          ],
        },
      })
      expect(tamperedResponse.status()).toBe(400)
      const tamperedBody = await readJsonSafe<{ error?: string }>(tamperedResponse)
      expect(tamperedBody?.error).toBe('import_delta_tampering')
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })

  test('rejects import payloads outside organization scope', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)

    const response = await apiRequest(request, 'POST', '/api/wms/inventory/import/validate', {
      token: adminToken,
      data: {
        organizationId: randomUUID(),
        tenantId: scope.tenantId,
        rows: [{ warehouseCode: 'X', locationCode: 'Y', sku: 'Z', quantity: '1' }],
      },
    })

    expect(response.status()).toBe(403)
  })
})
