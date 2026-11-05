import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales', 'catalog'],
}

type RolesResponse = {
  items?: Array<{
    id?: string
    name?: string
  }>
}

type RoleAclResponse = {
  isSuperAdmin?: boolean
  features?: string[]
  organizations?: string[] | null
}

type InventoryBalanceListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    catalog_variant_id?: string | null
    quantity_on_hand?: string | number | null
    quantity_reserved?: string | number | null
    quantity_allocated?: string | number | null
    quantity_available?: number | null
  }>
}

type InventoryReservationListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    catalog_variant_id?: string | null
    quantity?: string | number | null
    source_type?: string | null
    source_id?: string | null
    status?: string | null
  }>
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) return Number(value)
  return 0
}

async function createCrudFixture(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `Missing id in ${path} create response`)
}

async function ensureRoleFeatures(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  roleName: string,
  requiredFeatures: string[],
): Promise<() => Promise<void>> {
  const rolesResponse = await apiRequest(
    request,
    'GET',
    `/api/auth/roles?tenantId=${encodeURIComponent(tenantId)}&page=1&pageSize=100`,
    { token },
  )
  expect(rolesResponse.ok(), `Failed GET /api/auth/roles: ${rolesResponse.status()}`).toBeTruthy()
  const rolesBody = await readJsonSafe<RolesResponse>(rolesResponse)
  const role = rolesBody?.items?.find((item) => item.name === roleName) ?? null
  const roleId = expectId(role?.id, `Missing ${roleName} role in tenant ${tenantId}`)

  const aclPath = `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}&tenantId=${encodeURIComponent(tenantId)}`
  const aclResponse = await apiRequest(request, 'GET', aclPath, { token })
  expect(aclResponse.ok(), `Failed GET ${aclPath}: ${aclResponse.status()}`).toBeTruthy()
  const aclBody = (await readJsonSafe<RoleAclResponse>(aclResponse)) ?? {}
  const original = {
    isSuperAdmin: Boolean(aclBody.isSuperAdmin),
    features: Array.isArray(aclBody.features) ? aclBody.features : [],
    organizations: Array.isArray(aclBody.organizations) ? aclBody.organizations : null,
  }

  const mergedFeatures = Array.from(new Set([...original.features, ...requiredFeatures])).sort()
  const originalSorted = [...original.features].sort()
  const changed = mergedFeatures.join('|') !== originalSorted.join('|')

  if (changed) {
    const updateResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token,
      data: {
        roleId,
        tenantId,
        isSuperAdmin: original.isSuperAdmin,
        features: mergedFeatures,
        organizations: original.organizations,
      },
    })
    expect(updateResponse.ok(), `Failed PUT /api/auth/roles/acl: ${updateResponse.status()}`).toBeTruthy()
  }

  return async () => {
    if (!changed) return
    await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token,
      data: {
        roleId,
        tenantId,
        isSuperAdmin: original.isSuperAdmin,
        features: original.features,
        organizations: original.organizations,
      },
    }).catch(() => undefined)
  }
}

async function postAction<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  return (await readJsonSafe<T>(response)) as T
}

async function fetchBalance(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  catalogVariantId: string,
): Promise<NonNullable<InventoryBalanceListResponse['items']>[number]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/balances?warehouseId=${encodeURIComponent(warehouseId)}&catalogVariantId=${encodeURIComponent(catalogVariantId)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.ok(), `Failed GET /api/wms/inventory/balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<InventoryBalanceListResponse>(response)
  const balance = body?.items?.find(
    (item) => item.warehouse_id === warehouseId && item.catalog_variant_id === catalogVariantId,
  )
  expect(balance, `Expected balance for variant ${catalogVariantId} in warehouse ${warehouseId}`).toBeTruthy()
  return balance as NonNullable<InventoryBalanceListResponse['items']>[number]
}

async function fetchReservations(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  catalogVariantId: string,
): Promise<NonNullable<InventoryReservationListResponse['items']>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/reservations?warehouseId=${encodeURIComponent(warehouseId)}&catalogVariantId=${encodeURIComponent(catalogVariantId)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.ok(), `Failed GET /api/wms/inventory/reservations: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<InventoryReservationListResponse>(response)
  return body?.items ?? []
}

/**
 * TC-WMS-002: Insufficient Stock Rejection And Locking
 * Source: .ai/qa/scenarios/TC-WMS-002-insufficient-stock-rejection-and-locking.md
 */
test.describe('TC-WMS-002: Insufficient Stock Rejection And Locking', () => {
  test('should reject a second reservation when stock is already fully reserved', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
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
        'wms.manage_reservations',
        'wms.adjust_inventory',
      ],
    )

    let productId: string | null = null
    let warehouseId: string | null = null
    let locationId: string | null = null
    let profileId: string | null = null
    let firstOrderId: string | null = null
    let secondOrderId: string | null = null
    let reservationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA WMS Stock Lock Product ${stamp}`,
        sku: `QA-WMS-L-${stamp}`,
      })

      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `QA WMS Stock Lock Variant ${stamp}`,
        sku: `QA-WMS-LV-${stamp}`,
        isDefault: true,
      })

      firstOrderId = await createSalesOrderFixture(request, adminToken)
      secondOrderId = await createSalesOrderFixture(request, adminToken)

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Lock Warehouse ${stamp}`,
        code: `QA-L-WH-${stamp}`,
        isActive: true,
        timezone: 'UTC',
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `QA-L-BIN-${stamp}`,
        type: 'bin',
        isActive: true,
      })

      profileId = await createCrudFixture(request, adminToken, '/api/wms/inventory-profiles', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        catalogProductId: productId,
        catalogVariantId: variantId,
        defaultUom: 'pc',
        defaultStrategy: 'fifo',
        reorderPoint: 1,
        safetyStock: 0,
      })

      await postAction<{ ok: true; movementId: string }>(
        request,
        adminToken,
        '/api/wms/inventory/adjust',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          delta: 1,
          reason: 'QA setup stock for TC-WMS-002',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        },
      )

      const balanceBefore = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balanceBefore.quantity_on_hand)).toBe(1)
      expect(toNumber(balanceBefore.quantity_reserved)).toBe(0)
      expect(toNumber(balanceBefore.quantity_allocated)).toBe(0)
      expect(balanceBefore.quantity_available).toBe(1)

      const firstReserve = await postAction<{
        ok: true
        reservationId: string
        allocatedBuckets: Array<{ locationId: string; lotId: string | null; quantity: string }>
      }>(
        request,
        adminToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 1,
          sourceType: 'order',
          sourceId: firstOrderId,
        },
      )

      reservationId = firstReserve.reservationId
      expect(firstReserve.allocatedBuckets).toEqual([
        {
          locationId,
          lotId: null,
          quantity: '1',
        },
      ])

      const secondReserveResponse = await apiRequest(request, 'POST', '/api/wms/inventory/reserve', {
        token: adminToken,
        data: {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 1,
          sourceType: 'order',
          sourceId: secondOrderId,
        },
      })

      expect(secondReserveResponse.status()).toBe(409)
      const secondReserveBody = await readJsonSafe<{ error?: string }>(secondReserveResponse)
      expect(secondReserveBody?.error).toBe('insufficient_stock')

      const balanceAfterFailure = await fetchBalance(request, adminToken, warehouseId, variantId)
      expect(toNumber(balanceAfterFailure.quantity_on_hand)).toBe(1)
      expect(toNumber(balanceAfterFailure.quantity_reserved)).toBe(1)
      expect(toNumber(balanceAfterFailure.quantity_allocated)).toBe(0)
      expect(balanceAfterFailure.quantity_available).toBe(0)

      const reservations = await fetchReservations(request, adminToken, warehouseId, variantId)
      const activeReservations = reservations.filter((item) => item.status === 'active')
      expect(activeReservations).toHaveLength(1)
      expect(activeReservations[0]).toMatchObject({
        id: reservationId,
        warehouse_id: warehouseId,
        catalog_variant_id: variantId,
        source_type: 'order',
        source_id: firstOrderId,
        status: 'active',
      })
      expect(toNumber(activeReservations[0]?.quantity)).toBe(1)
      expect(
        reservations.some((item) => item.source_id === secondOrderId),
        'Rejected reservation must not persist any reservation row',
      ).toBe(false)
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'QA cleanup for TC-WMS-002',
          },
        }).catch(() => undefined)
      }

      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', secondOrderId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', firstOrderId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
    }
  })
})
