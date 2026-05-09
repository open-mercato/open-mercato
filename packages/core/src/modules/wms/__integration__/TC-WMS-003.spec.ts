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

type JsonRecord = Record<string, unknown>

type SalesOrdersResponse = {
  items?: JsonRecord[]
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

type WmsEnrichment = {
  assignedWarehouseId: string | null
  stockSummary: Array<{
    catalogVariantId: string
    available: string
    reserved: string
  }>
  reservationSummary: {
    status: string
    reservationIds: string[]
  }
}

function stripAdditiveNamespaces(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith('_')),
  )
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

async function fetchSalesOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
  options?: { cookieHeader?: string },
): Promise<JsonRecord> {
  const path = `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`
  const response = options?.cookieHeader
    ? await request.fetch(path, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          cookie: options.cookieHeader,
        },
      })
    : await apiRequest(
        request,
        'GET',
        path,
        { token },
      )
  expect(response.ok(), `Failed GET /api/sales/orders for ${orderId}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<SalesOrdersResponse>(response)
  const order = body?.items?.find((item) => item.id === orderId) ?? null
  expect(order, `Order ${orderId} should be returned by sales list route`).toBeTruthy()
  return order as JsonRecord
}

/**
 * TC-WMS-003: Sales Order WMS Enrichment
 * Source: .ai/qa/scenarios/TC-WMS-003-sales-order-wms-enrichment.md
 */
test.describe('TC-WMS-003: Sales Order WMS Enrichment', () => {
  test('should expose additive _wms data on opted-in sales order responses', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const wmsToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const selectedScopeCookie = [
      `om_selected_tenant=${encodeURIComponent(scope.tenantId)}`,
      `om_selected_org=${encodeURIComponent(scope.organizationId)}`,
    ].join('; ')
    const restoreSalesOrderToggle = await ensureBooleanFeatureToggle(
      request,
      wmsToken,
      'wms_integration_sales_order_inventory',
      'Sales Order Inventory Reservation',
      'Allows WMS to reserve and release inventory from sales order lifecycle events.',
      'wms',
    )
    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      wmsToken,
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
    let reservationId: string | null = null

    try {
      productId = await createProductFixture(request, adminToken, {
        title: `QA WMS Product ${stamp}`,
        sku: `QA-WMS-P-${stamp}`,
      })

      const variantId = await createVariantFixture(request, adminToken, {
        productId,
        name: `QA WMS Variant ${stamp}`,
        sku: `QA-WMS-V-${stamp}`,
        isDefault: true,
      })

      orderId = await createSalesOrderFixture(request, adminToken)
      await createOrderLineFixture(request, adminToken, orderId, {
        productId,
        productVariantId: variantId,
        quantity: 3,
        name: `QA WMS Line ${stamp}`,
      })

      const baselineOrder = await fetchSalesOrder(request, adminToken, orderId)

      warehouseId = await createCrudFixture(request, wmsToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Warehouse ${stamp}`,
        code: `QA-WH-${stamp}`,
        isActive: true,
        timezone: 'UTC',
      })

      locationId = await createCrudFixture(request, wmsToken, '/api/wms/locations', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        code: `QA-BIN-${stamp}`,
        type: 'bin',
        isActive: true,
      })

      profileId = await createCrudFixture(request, wmsToken, '/api/wms/inventory-profiles', {
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
        wmsToken,
        '/api/wms/inventory/adjust',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          locationId,
          catalogVariantId: variantId,
          delta: 10,
          reason: 'QA setup stock for TC-WMS-003',
          referenceType: 'manual',
          referenceId: randomUUID(),
          performedBy: scope.userId,
        },
      )

      const reserveBody = await postAction<{
        ok: true
        reservationId: string
      }>(
        request,
        wmsToken,
        '/api/wms/inventory/reserve',
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          warehouseId,
          catalogVariantId: variantId,
          quantity: 3,
          sourceType: 'order',
          sourceId: orderId,
        },
      )
      reservationId = reserveBody.reservationId

      const enrichedOrder = await fetchSalesOrder(request, wmsToken, orderId, {
        cookieHeader: selectedScopeCookie,
      })

      expect(stripAdditiveNamespaces(enrichedOrder)).toEqual(
        stripAdditiveNamespaces(baselineOrder),
      )

      const wms = enrichedOrder._wms as WmsEnrichment | undefined
      expect(wms).toBeTruthy()
      expect(wms?.assignedWarehouseId).toBe(warehouseId)
      expect(wms?.reservationSummary.status).toBe('fully_reserved')
      expect(wms?.reservationSummary.reservationIds).toContain(reservationId)
      expect(wms?.stockSummary).toEqual([
        {
          catalogVariantId: variantId,
          available: '7',
          reserved: '3',
        },
      ])
    } finally {
      if (reservationId) {
        await apiRequest(request, 'POST', '/api/wms/inventory/release', {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            reservationId,
            reason: 'QA cleanup for TC-WMS-003',
          },
        }).catch(() => undefined)
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
