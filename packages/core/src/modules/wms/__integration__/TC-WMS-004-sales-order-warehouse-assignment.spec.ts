import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
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
import { ensureBooleanFeatureToggle } from './helpers/wmsFixtures'

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales'],
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

type SalesOrdersResponse = {
  items?: Array<Record<string, unknown>>
}

type WarehouseAssignmentResponse = {
  assignment?: {
    id?: string
    salesOrderId?: string
    warehouseId?: string
    warehouseName?: string | null
  } | null
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
  const changed = mergedFeatures.join('|') !== [...original.features].sort().join('|')

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
    expect(updateResponse.ok(), `Failed PUT ${aclPath}: ${updateResponse.status()}`).toBeTruthy()
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
    })
  }
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

test.describe('TC-WMS-004 sales order warehouse assignment', () => {
  test('should assign, read, enrich, and clear explicit warehouse assignment', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)
    const stamp = randomUUID().slice(0, 8)

    const restoreAdminAcl = await ensureRoleFeatures(
      request,
      adminToken,
      scope.tenantId,
      'admin',
      ['wms.view', 'wms.manage_reservations', 'wms.manage_warehouses', 'sales.orders.view'],
    )

    const restoreSalesOrderToggle = await ensureBooleanFeatureToggle(
      request,
      superadminToken,
      'wms_integration_sales_order_inventory',
      'Sales Order Inventory Reservation',
      'Allows WMS to reserve and release inventory from sales order lifecycle events.',
      'wms',
    )

    let orderId: string | null = null
    let warehouseId: string | null = null

    try {
      orderId = await createSalesOrderFixture(request, adminToken)

      warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        name: `QA Warehouse ${stamp}`,
        code: `QA-WH-${stamp}`,
        isActive: true,
      })

      const assignResponse = await apiRequest(
        request,
        'PUT',
        `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
        {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            warehouseId,
          },
        },
      )
      expect(
        assignResponse.ok(),
        `Failed PUT warehouse-assignment: ${assignResponse.status()}`,
      ).toBeTruthy()

      const getAssignmentResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
        { token: adminToken },
      )
      expect(
        getAssignmentResponse.ok(),
        `Failed GET warehouse-assignment: ${getAssignmentResponse.status()}`,
      ).toBeTruthy()
      const assignmentBody = await readJsonSafe<WarehouseAssignmentResponse>(getAssignmentResponse)
      expect(assignmentBody?.assignment?.warehouseId).toBe(warehouseId)

      const salesOrderResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(salesOrderResponse.ok(), `Failed GET /api/sales/orders: ${salesOrderResponse.status()}`).toBeTruthy()
      const salesOrderBody = await readJsonSafe<SalesOrdersResponse>(salesOrderResponse)
      const enriched = salesOrderBody?.items?.[0]
      const wms = enriched?._wms as {
        assignedWarehouseId?: string | null
        isExplicitlyAssigned?: boolean
      } | undefined
      expect(wms?.assignedWarehouseId).toBe(warehouseId)
      expect(wms?.isExplicitlyAssigned).toBe(true)

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
        {
          token: adminToken,
          data: {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
          },
        },
      )
      expect(
        deleteResponse.ok(),
        `Failed DELETE warehouse-assignment: ${deleteResponse.status()}`,
      ).toBeTruthy()

      const clearedResponse = await apiRequest(
        request,
        'GET',
        `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
        { token: adminToken },
      )
      const clearedBody = await readJsonSafe<WarehouseAssignmentResponse>(clearedResponse)
      expect(clearedBody?.assignment).toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      await restoreSalesOrderToggle()
      await restoreAdminAcl()
    }
  })
})
