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

type PutawayTaskListResponse = {
  items?: Array<{
    id?: string
    status?: string | null
    source_location_id?: string | null
    target_location_id?: string | null
    quantity?: string | number | null
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

test.describe('WMS-P2-INT-05 / putaway ACL: complete putaway task', () => {
  test('auto-creates putaway on QC pass, completes staging→bin move, denies without manage_putaway', async ({
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
        'wms.manage_putaway',
        'wms.receive_inventory',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let stagingId: string | null = null
    let binId: string | null = null
    let profileId: string | null = null
    let asnId: string | null = null
    let taskId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `WMS-P2 Putaway ${suffix}`,
        sku: `P2PUT-${suffix}`,
      })
      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `WMS-P2 Putaway Variant ${suffix}`,
        sku: `P2PUTV-${suffix}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `WMS-P2 Putaway WH ${suffix}`,
        code: `P2P${suffix}`,
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

      binId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `BIN-${suffix}`,
        type: 'bin',
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
          referenceNumber: `ASN-PUT-${suffix}`,
          lines: [{ catalogVariantId: variantId, expectedQty: 8 }],
        },
      })
      expect(createResponse.ok(), `Failed create ASN: ${createResponse.status()}`).toBeTruthy()
      const created = await readJsonSafe<{ id?: string; lineIds?: string[] }>(createResponse)
      asnId = created?.id ?? null
      const lineId = created?.lineIds?.[0] ?? null
      expect(asnId).toBeTruthy()
      expect(lineId).toBeTruthy()

      const receiveResult = await postAction<ReceiveResponse>(
        request,
        adminToken,
        `/api/wms/asns/${asnId}/receive`,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          lineId,
          receivedQty: 8,
          targetReceivedQty: 8,
          targetStagingLocationId: stagingId,
          qcStatus: 'passed',
          performedBy: scope.userId,
        },
      )
      expect(receiveResult.ok).toBe(true)
      expect(receiveResult.putawayTaskIds?.length).toBe(1)
      taskId = receiveResult.putawayTaskIds?.[0] ?? null
      expect(taskId).toBeTruthy()

      const taskList = await apiRequest(
        request,
        'GET',
        `/api/wms/putaway-tasks?ids=${encodeURIComponent(taskId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(taskList.ok()).toBeTruthy()
      const taskBody = await readJsonSafe<PutawayTaskListResponse>(taskList)
      expect(taskBody?.items?.[0]?.status).toBe('open')
      expect(taskBody?.items?.[0]?.source_location_id).toBe(stagingId)
      expect(taskBody?.items?.[0]?.target_location_id ?? null).toBeNull()

      const denied = await apiRequest(request, 'POST', `/api/wms/putaway-tasks/${taskId}/complete`, {
        token: employeeToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          confirmedQuantity: 8,
          targetLocationId: binId,
          performedBy: scope.userId,
        },
      })
      expect(denied.status()).toBe(403)

      const beforeStaging = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: stagingId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )
      const beforeBin = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: binId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )

      const complete = await postAction<{ ok?: boolean; movementId?: string }>(
        request,
        adminToken,
        `/api/wms/putaway-tasks/${taskId}/complete`,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          confirmedQuantity: 8,
          targetLocationId: binId,
          performedBy: scope.userId,
        },
      )
      expect(complete.ok).toBe(true)
      expect(complete.movementId).toBeTruthy()

      const afterStaging = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: stagingId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )
      const afterBin = toNumber(
        (
          await fetchBalanceAtLocation(request, adminToken, {
            warehouseId,
            locationId: binId!,
            catalogVariantId: variantId,
          })
        )?.quantity_on_hand,
      )
      expect(afterStaging).toBe(beforeStaging - 8)
      expect(afterBin).toBe(beforeBin + 8)

      const putawayMovements = await fetchMovements(request, adminToken, {
        warehouseId,
        catalogVariantId: variantId,
        type: 'putaway',
      })
      expect(putawayMovements.some((row) => row.id === complete.movementId)).toBe(true)
      const completedTask = await apiRequest(
        request,
        'GET',
        `/api/wms/putaway-tasks?ids=${encodeURIComponent(taskId!)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      const completedBody = await readJsonSafe<PutawayTaskListResponse>(completedTask)
      expect(completedBody?.items?.[0]?.status).toBe('done')
      expect(completedBody?.items?.[0]?.target_location_id).toBe(binId)
    } finally {
      await restoreAdminAcl()
      if (asnId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/asns', asnId)
      }
      if (profileId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      }
      if (binId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', binId)
      }
      if (stagingId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', stagingId)
      }
      if (warehouseId) {
        await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      }
      if (productId) {
        await deleteCatalogProductIfExists(request, adminToken, productId)
      }
    }
  })
})
