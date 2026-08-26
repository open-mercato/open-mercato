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
  fetchMovements,
  postAction,
  toNumber,
} from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'catalog'],
}

type AsnCreateResponse = {
  id?: string
  lineIds?: string[]
}

type ReceiveResponse = {
  ok?: boolean
  movementIds?: string[]
  putawayTaskIds?: string[]
}

type BalanceListResponse = {
  items?: Array<{
    id?: string
    location_id?: string | null
    catalog_variant_id?: string | null
    quantity_on_hand?: string | number | null
  }>
}

type ReceivingLineListResponse = {
  items?: Array<{
    id?: string
    expected_qty?: string | number | null
    received_qty?: string | number | null
    qc_status?: string | null
    rejection_reason?: string | null
  }>
}

async function fetchBalanceAtLocation(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  query: {
    warehouseId: string
    locationId: string
    catalogVariantId: string
  },
) {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '20',
    warehouseId: query.warehouseId,
    locationId: query.locationId,
    catalogVariantId: query.catalogVariantId,
  })
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/balances?${params.toString()}`,
    { token },
  )
  expect(response.ok(), `Failed GET balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<BalanceListResponse>(response)
  return body?.items?.[0] ?? null
}

async function fetchReceivingLine(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  lineId: string,
) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/receiving-lines?ids=${encodeURIComponent(lineId)}&page=1&pageSize=1`,
    { token },
  )
  expect(response.ok(), `Failed GET receiving-lines: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<ReceivingLineListResponse>(response)
  return body?.items?.[0] ?? null
}

test.describe('WMS-P2-INT-01…04 / INT-09: ASN receiving', () => {
  test('creates ASN with vendor + lines, QC pass/fail, over-receipt, and ACL denial', async ({
    request,
  }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const employeeToken = await getAuthToken(request, 'employee')
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
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null
    let passLineId: string | null = null
    let failLineId: string | null = null
    let overLineId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 ASN ${suffix}`,
        sku: `P2ASN-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 ASN Variant ${suffix}`,
        sku: `P2ASNV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `WMS-P2 ASN WH ${suffix}`,
        code: `P2A${suffix}`,
        city: 'Lodz',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        isActive: true,
      })

      stagingId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `STG-${suffix}`,
        type: 'staging',
        capacityUnits: 500,
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pcs',
        defaultStrategy: 'fifo',
      })

      const createResponse = await apiRequest(request, 'POST', '/api/wms/asns', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          expectedAt: new Date().toISOString(),
          referenceNumber: `ASN-${suffix}`,
          lines: [
            { catalogVariantId: variantId, expectedQty: 10 },
            { catalogVariantId: variantId, expectedQty: 4 },
            { catalogVariantId: variantId, expectedQty: 2 },
          ],
        },
      })
      expect(createResponse.ok(), `Failed create ASN: ${createResponse.status()}`).toBeTruthy()
      const created = await readJsonSafe<AsnCreateResponse>(createResponse)
      asnId = created?.id ?? null
      expect(asnId).toBeTruthy()
      expect(created?.lineIds?.length).toBe(3)
      passLineId = created?.lineIds?.[0] ?? null
      failLineId = created?.lineIds?.[1] ?? null
      overLineId = created?.lineIds?.[2] ?? null

      const asnDetail = await apiRequest(
        request,
        'GET',
        `/api/wms/asns?ids=${encodeURIComponent(asnId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(asnDetail.ok()).toBeTruthy()
      const asnBody = await readJsonSafe<{
        items?: Array<{ vendor_id?: string | null; status?: string | null; reference_number?: string | null }>
      }>(asnDetail)
      expect(asnBody?.items?.[0]?.vendor_id == null).toBe(true)
      expect(asnBody?.items?.[0]?.status).toBe('draft')
      expect(asnBody?.items?.[0]?.reference_number).toBe(`ASN-${suffix}`)

      // INT-09: employee without receive_inventory cannot receive
      const denied = await apiRequest(request, 'POST', `/api/wms/asns/${asnId}/receive`, {
        token: employeeToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineId: passLineId,
          receivedQty: 10,
          targetReceivedQty: 10,
          targetStagingLocationId: stagingId,
          qcStatus: 'passed',
          performedBy: scope.userId,
        },
      })
      expect(denied.status()).toBe(403)

      const beforePassBalance = await fetchBalanceAtLocation(request, adminToken, {
        warehouseId,
        locationId: stagingId!,
        catalogVariantId: variantId,
      })
      const beforeOnHand = toNumber(beforePassBalance?.quantity_on_hand)

      // INT-02: QC pass → receipt movement + balance + putaway task
      const passResult = await postAction<ReceiveResponse>(
        request,
        adminToken,
        `/api/wms/asns/${asnId}/receive`,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineId: passLineId,
          receivedQty: 10,
          targetReceivedQty: 10,
          targetStagingLocationId: stagingId,
          qcStatus: 'passed',
          performedBy: scope.userId,
        },
      )
      expect(passResult.ok).toBe(true)
      expect(passResult.movementIds?.length).toBeGreaterThan(0)
      expect(passResult.putawayTaskIds?.length).toBeGreaterThan(0)

      const afterPassBalance = await fetchBalanceAtLocation(request, adminToken, {
        warehouseId,
        locationId: stagingId!,
        catalogVariantId: variantId,
      })
      expect(toNumber(afterPassBalance?.quantity_on_hand)).toBe(beforeOnHand + 10)

      const passMovements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        type: 'receipt',
      })
      expect(passMovements.length).toBeGreaterThan(0)
      expect(toNumber(passMovements[0]?.quantity)).toBeGreaterThan(0)

      const passLine = await fetchReceivingLine(request, adminToken, passLineId!)
      expect(passLine?.qc_status).toBe('passed')
      expect(toNumber(passLine?.received_qty)).toBe(10)
      expect(toNumber(passLine?.expected_qty)).toBe(10)

      // INT-03: QC fail → no stock increase
      const beforeFailOnHand = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: stagingId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )
      const failResult = await postAction<ReceiveResponse>(
        request,
        adminToken,
        `/api/wms/asns/${asnId}/receive`,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineId: failLineId,
          receivedQty: 4,
          targetReceivedQty: 4,
          qcStatus: 'failed',
          rejectionReason: 'Damaged packaging',
          performedBy: scope.userId,
        },
      )
      expect(failResult.ok).toBe(true)
      expect(failResult.movementIds).toEqual([])
      expect(failResult.putawayTaskIds).toEqual([])

      const afterFailOnHand = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: stagingId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )
      expect(afterFailOnHand).toBe(beforeFailOnHand)

      const failLine = await fetchReceivingLine(request, adminToken, failLineId!)
      expect(failLine?.qc_status).toBe('failed')
      expect(toNumber(failLine?.received_qty)).toBe(4)
      expect(failLine?.rejection_reason).toBe('Damaged packaging')

      // INT-04: over-receipt keeps expected qty and records higher received qty
      await postAction<ReceiveResponse>(request, adminToken, `/api/wms/asns/${asnId}/receive`, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        lineId: overLineId,
        receivedQty: 5,
        targetReceivedQty: 5,
        targetStagingLocationId: stagingId,
        qcStatus: 'passed',
        performedBy: scope.userId,
      })
      const overLine = await fetchReceivingLine(request, adminToken, overLineId!)
      expect(toNumber(overLine?.expected_qty)).toBe(2)
      expect(toNumber(overLine?.received_qty)).toBe(5)
      expect(overLine?.qc_status).toBe('passed')

      const complete = await postAction<{ ok?: boolean; status?: string }>(
        request,
        adminToken,
        `/api/wms/asns/${asnId}/complete`,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          closeWhenShort: true,
        },
      )
      expect(complete.ok).toBe(true)
      expect(complete.status).toBe('received')
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
