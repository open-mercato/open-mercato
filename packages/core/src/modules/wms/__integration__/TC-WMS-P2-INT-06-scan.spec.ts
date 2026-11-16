import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import { createCompanyFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCrudFixture,
  ensureRoleFeatures,
  postAction,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog', 'customers'],
}

type AsnCreateResponse = {
  id?: string
  lineIds?: string[]
}

type ScanResolveLocationResponse = {
  ok?: boolean
  locationId?: string
  code?: string
  type?: string
}

type ScanResolveLotResponse = {
  ok?: boolean
  lotId?: string
  lotNumber?: string
}

type ScanReceiveResponse = {
  ok?: boolean
  movementIds?: string[]
  putawayTaskIds?: string[]
}

test.describe('WMS-P2-INT-06: Scan endpoints', () => {
  test('resolves location/lot and receives via scan receive path', async ({ request }) => {
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
        'wms.manage_asn',
        'wms.receive_inventory',
        'customers.companies.view',
        'customers.companies.manage',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let profileId: string | null = null
    let lotId: string | null = null
    let asnId: string | null = null
    let companyId: string | null = null

    try {
      companyId = await createCompanyFixture(request, adminToken, `WMS-P2 Vendor ${suffix}`)

      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Scan ${suffix}`,
        sku: `P2SCAN-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Scan Variant ${suffix}`,
        sku: `P2SCANV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `WMS-P2 Scan WH ${suffix}`,
        code: `P2S${suffix}`,
        timezone: 'UTC',
        isActive: true,
      })

      stagingId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `SCAN-STG-${suffix}`,
        type: 'staging',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
        trackLot: true,
      })

      lotId = await createCrudFixture(request, adminToken, '/api/wms/lots', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogVariantId: variantId,
        sku: `P2SCANV-${suffix}`,
        lotNumber: `LOT-SCAN-${suffix}`,
        status: 'available',
      })

      const createResponse = await apiRequest(request, 'POST', '/api/wms/asns', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          vendorId: companyId,
          expectedAt: new Date().toISOString(),
          referenceNumber: `ASN-SCAN-${suffix}`,
          lines: [{ catalogVariantId: variantId, expectedQty: 5, lotNumber: `LOT-SCAN-${suffix}` }],
        },
      })
      expect(createResponse.ok(), `Failed create ASN: ${createResponse.status()}`).toBeTruthy()
      const created = await readJsonSafe<AsnCreateResponse>(createResponse)
      asnId = created?.id ?? null
      const lineId = created?.lineIds?.[0] ?? null
      expect(asnId).toBeTruthy()
      expect(lineId).toBeTruthy()

      const asnList = await apiRequest(
        request,
        'GET',
        `/api/wms/asns?ids=${encodeURIComponent(asnId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(asnList.ok()).toBeTruthy()
      const asnBody = await readJsonSafe<{
        items?: Array<{ vendor_id?: string | null; vendor_name?: string | null }>
      }>(asnList)
      expect(asnBody?.items?.[0]?.vendor_id).toBe(companyId)
      expect(asnBody?.items?.[0]?.vendor_name).toBe(`WMS-P2 Vendor ${suffix}`)

      const resolvedLocation = await postAction<ScanResolveLocationResponse>(
        request,
        adminToken,
        '/api/wms/scan/resolve-location',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          code: `SCAN-STG-${suffix}`,
        },
      )
      expect(resolvedLocation.ok).toBe(true)
      expect(resolvedLocation.locationId).toBe(stagingId)
      expect(resolvedLocation.type).toBe('staging')

      const resolvedLot = await postAction<ScanResolveLotResponse>(
        request,
        adminToken,
        '/api/wms/scan/resolve-lot',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          catalogVariantId: variantId,
          lotNumber: `LOT-SCAN-${suffix}`,
        },
      )
      expect(resolvedLot.ok).toBe(true)
      expect(resolvedLot.lotId).toBe(lotId)

      const missing = await apiRequest(request, 'POST', '/api/wms/scan/resolve-location', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          code: `MISSING-${suffix}`,
        },
      })
      expect(missing.status()).toBe(404)

      const receiveResult = await postAction<ScanReceiveResponse>(
        request,
        adminToken,
        '/api/wms/scan/receive',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          asnId,
          lineId,
          locationCode: `SCAN-STG-${suffix}`,
          lotNumber: `LOT-SCAN-${suffix}`,
          receivedQty: 5,
          targetReceivedQty: 5,
          qcStatus: 'passed',
          performedBy: scope.userId,
        },
      )
      expect(receiveResult.ok).toBe(true)
      expect(receiveResult.movementIds?.length).toBeGreaterThan(0)
      expect(receiveResult.putawayTaskIds?.length).toBeGreaterThan(0)
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/lots', lotId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      await restoreAdminAcl()
    }
  })
})
