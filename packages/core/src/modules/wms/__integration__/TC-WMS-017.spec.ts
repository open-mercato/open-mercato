import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/helpers/integration/catalogFixtures'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createOrderLineFixture,
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

type FeatureToggleListResponse = {
  items?: Array<{
    id?: string
    identifier?: string
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

type InventoryBalanceListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    catalog_variant_id?: string | null
    quantity_reserved?: string | number | null
    quantity_available?: number | null
  }>
}

type SalesStatusListResponse = {
  items?: Array<{
    id?: string
    value?: string | null
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

async function ensureBooleanFeatureToggle(
  request: APIRequestContext,
  token: string,
  identifier: string,
  name: string,
  description: string,
  category: string,
): Promise<() => Promise<void>> {
  const listResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global?identifier=${encodeURIComponent(identifier)}&page=1&pageSize=10`,
    { token },
  )
  expect(
    listResponse.ok(),
    `Failed GET /api/feature_toggles/global for ${identifier}: ${listResponse.status()}`,
  ).toBeTruthy()

  const listBody = await readJsonSafe<FeatureToggleListResponse>(listResponse)
  const existingToggle = listBody?.items?.find((item) => item.identifier === identifier) ?? null
  if (existingToggle?.id) {
    return async () => undefined
  }

  const toggleId = await createFeatureToggleFixture(request, token, {
    identifier,
    name,
    description,
    category,
    type: 'boolean',
    defaultValue: true,
  })

  return async () => {
    await deleteFeatureToggleIfExists(request, token, toggleId)
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

async function fetchReservationsForOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
): Promise<NonNullable<InventoryReservationListResponse['items']>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/reservations?sourceType=order&sourceId=${encodeURIComponent(orderId)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.ok(), `Failed GET /api/wms/inventory/reservations: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<InventoryReservationListResponse>(response)
  return body?.items ?? []
}

async function fetchBalance(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  variantId: string,
) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/balances?warehouseId=${encodeURIComponent(warehouseId)}&catalogVariantId=${encodeURIComponent(variantId)}&page=1&pageSize=20`,
    { token },
  )
  expect(response.ok(), `Failed GET /api/wms/inventory/balances: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<InventoryBalanceListResponse>(response)
  return body?.items?.find(
    (item) => item.warehouse_id === warehouseId && item.catalog_variant_id === variantId,
  ) ?? null
}

async function fetchOrderStatusId(
  request: APIRequestContext,
  token: string,
  value: 'confirmed' | 'canceled',
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    '/api/sales/order-statuses?page=1&pageSize=100',
    { token },
  )
  expect(response.ok(), `Failed GET /api/sales/order-statuses: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<SalesStatusListResponse>(response)
  const status = body?.items?.find((item) => item.value === value) ?? null
  return expectId(status?.id, `Missing order status "${value}"`)
}

/**
 * TC-WMS-017: Sales Order Event-Driven Reservation Lifecycle
 */
test.describe('TC-WMS-017: Sales Order Event-Driven Reservation Lifecycle', () => {
  test('should reserve on sales.order.confirmed and release on sales.order.cancelled', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()

    const restoreSalesOrderToggle = await ensureBooleanFeatureToggle(
      request,
      superadminToken,
      'wms_integration_sales_order_inventory',
      'Sales Order Inventory Reservation',
      'Allows WMS to reserve and release inventory from sales order lifecycle events.',
      'wms',
    )
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
    let orderId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA Event Product ${stamp}`,
        sku: `QA-WMS-E-${stamp}`,
      })

      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `QA Event Variant ${stamp}`,
        sku: `QA-WMS-EV-${stamp}`,
        isDefault: true,
      })

      orderId = await createSalesOrderFixture(request, adminToken)
      await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: variantId,
        quantity: 3,
        name: `QA Event Line ${stamp}`,
      })

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Event Warehouse ${stamp}`,
        code: `QA-E-WH-${stamp}`,
        isActive: true,
        timezone: 'UTC',
      })

      locationId = await createCrudFixture(request, adminToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `QA-E-BIN-${stamp}`,
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
        reorderPoint: 2,
        safetyStock: 1,
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
          delta: 5,
          reason: 'QA setup stock for TC-WMS-017',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        },
      )

      const confirmedStatusId = await fetchOrderStatusId(request, superadminToken, 'confirmed')
      const canceledStatusId = await fetchOrderStatusId(request, superadminToken, 'canceled')

      const confirmResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token: adminToken,
        data: {
          id: orderId,
          statusEntryId: confirmedStatusId,
        },
      })
      expect(confirmResponse.ok(), `Failed PUT /api/sales/orders confirm: ${confirmResponse.status()}`).toBeTruthy()

      await expect.poll(async () => {
        const reservations = await fetchReservationsForOrder(request, adminToken, orderId!)
        const activeReservations = reservations.filter((item) => item.status === 'active')
        const balance = await fetchBalance(request, adminToken, warehouseId!, variantId)
        return {
          activeCount: activeReservations.length,
          activeQuantity: activeReservations.reduce((sum, item) => sum + toNumber(item.quantity), 0),
          reservedQuantity: toNumber(balance?.quantity_reserved),
          availableQuantity: balance?.quantity_available ?? 0,
          warehouseIds: activeReservations.map((item) => item.warehouse_id).filter(Boolean),
        }
      }, {
        timeout: 10_000,
        intervals: [250, 500, 1_000],
      }).toEqual({
        activeCount: 1,
        activeQuantity: 3,
        reservedQuantity: 3,
        availableQuantity: 2,
        warehouseIds: [warehouseId],
      })

      const cancelResponse = await apiRequest(request, 'PUT', '/api/sales/orders', {
        token: adminToken,
        data: {
          id: orderId,
          statusEntryId: canceledStatusId,
        },
      })
      expect(cancelResponse.ok(), `Failed PUT /api/sales/orders cancel: ${cancelResponse.status()}`).toBeTruthy()

      await expect.poll(async () => {
        const reservations = await fetchReservationsForOrder(request, adminToken, orderId!)
        const activeReservations = reservations.filter((item) => item.status === 'active')
        const releasedReservations = reservations.filter((item) => item.status === 'released')
        const balance = await fetchBalance(request, adminToken, warehouseId!, variantId)
        return {
          activeCount: activeReservations.length,
          releasedQuantity: releasedReservations.reduce((sum, item) => sum + toNumber(item.quantity), 0),
          reservedQuantity: toNumber(balance?.quantity_reserved),
          availableQuantity: balance?.quantity_available ?? 0,
        }
      }, {
        timeout: 10_000,
        intervals: [250, 500, 1_000],
      }).toEqual({
        activeCount: 0,
        releasedQuantity: 3,
        reservedQuantity: 0,
        availableQuantity: 5,
      })
    } finally {
      if (orderId) {
        const reservations = await fetchReservationsForOrder(request, adminToken, orderId).catch(() => [])
        for (const reservation of reservations) {
          if (reservation.id && reservation.status === 'active') {
            await apiRequest(request, 'POST', '/api/wms/inventory/release', {
              token: adminToken,
              data: {
                organizationId: scope.organizationId,
                tenantId: scope.tenantId,
                reservationId: reservation.id,
                reason: 'QA cleanup for TC-WMS-017',
              },
            }).catch(() => undefined)
          }
        }
      }

      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/inventory-profiles', profileId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/locations', locationId)
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await deleteCatalogProductIfExists(request, adminToken, productId)
      await restoreAdminAcl()
      await restoreSalesOrderToggle()
    }
  })
})
