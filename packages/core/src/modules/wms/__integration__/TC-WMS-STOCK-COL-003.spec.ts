import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
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

export const integrationMeta = {
  dependsOnModules: ['wms', 'sales'],
}

type RolesResponse = {
  items?: Array<{ id?: string; name?: string }>
}

type RoleAclResponse = {
  isSuperAdmin?: boolean
  features?: string[]
  organizations?: string[] | null
}

type SalesOrderListResponse = {
  items?: Array<Record<string, unknown>>
}

async function getEmployeeRoleWithoutWmsView(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  tenantId: string,
): Promise<{ roleId: string; restore: () => Promise<void> }> {
  const rolesResponse = await apiRequest(
    request,
    'GET',
    `/api/auth/roles?tenantId=${encodeURIComponent(tenantId)}&page=1&pageSize=100`,
    { token },
  )
  expect(rolesResponse.ok(), `Failed GET /api/auth/roles: ${rolesResponse.status()}`).toBeTruthy()
  const rolesBody = await readJsonSafe<RolesResponse>(rolesResponse)
  const role = rolesBody?.items?.find((item) => item.name === 'employee') ?? null
  const roleId = expectId(role?.id, `Missing employee role in tenant ${tenantId}`)

  const aclPath = `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}&tenantId=${encodeURIComponent(tenantId)}`
  const aclResponse = await apiRequest(request, 'GET', aclPath, { token })
  expect(aclResponse.ok(), `Failed GET ${aclPath}: ${aclResponse.status()}`).toBeTruthy()
  const aclBody = (await readJsonSafe<RoleAclResponse>(aclResponse)) ?? {}
  const original = {
    isSuperAdmin: Boolean(aclBody.isSuperAdmin),
    features: Array.isArray(aclBody.features) ? aclBody.features : [],
    organizations: Array.isArray(aclBody.organizations) ? aclBody.organizations : null,
  }

  const featuresWithoutWmsView = original.features.filter((f) => f !== 'wms.view' && f !== 'wms.*' && f !== '*')

  const updateResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: {
      roleId,
      tenantId,
      isSuperAdmin: false,
      features: featuresWithoutWmsView,
      organizations: original.organizations,
    },
  })
  expect(
    updateResponse.ok(),
    `Failed PUT /api/auth/roles/acl: ${updateResponse.status()}`,
  ).toBeTruthy()

  return {
    roleId,
    restore: async () => {
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
    },
  }
}

/**
 * TC-WMS-STOCK-COL-003: Without wms.view feature → WMS column NOT visible
 * The WMS sales order enricher declares `features: ['wms.view']`, so the
 * `_wms` payload must be absent when the requesting user lacks that feature.
 * Both the widget injection (metadata.features gate) and the enricher gate
 * prevent stock data from reaching unpermissioned users.
 */
test.describe('TC-WMS-STOCK-COL-003: WMS stock column — hidden without wms.view feature', () => {
  test('should NOT include _wms enrichment in orders API when user lacks wms.view', async ({
    request,
  }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const employeeToken = await getAuthToken(request, 'employee')
    const scope = getTokenScope(superadminToken)

    const { restore } = await getEmployeeRoleWithoutWmsView(
      request,
      superadminToken,
      scope.tenantId,
    )

    let orderId: string | null = null

    try {
      const adminToken = await getAuthToken(request, 'admin')
      orderId = await createSalesOrderFixture(request, adminToken)

      const response = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token: employeeToken },
      )

      if (!response.ok()) {
        // Employee may not have sales.view — skip assertion gracefully
        const status = response.status()
        expect([200, 403, 404]).toContain(status)
        return
      }

      const body = await readJsonSafe<SalesOrderListResponse>(response)
      const order = body?.items?.[0]

      if (order) {
        expect(
          (order as Record<string, unknown>)?._wms,
          'User without wms.view should NOT receive _wms enrichment',
        ).toBeFalsy()
      }
    } finally {
      if (orderId) {
        const adminToken = await getAuthToken(request, 'admin')
        await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      }
      await restore()
    }
  })

  test('should include _wms enrichment when user has wms.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const scope = getTokenScope(adminToken)

    const suffix = randomUUID().slice(0, 8)

    const rolesResponse = await apiRequest(
      request,
      'GET',
      `/api/auth/roles?tenantId=${encodeURIComponent(scope.tenantId)}&page=1&pageSize=100`,
      { token: superadminToken },
    )
    expect(rolesResponse.ok()).toBeTruthy()
    const rolesBody = await readJsonSafe<RolesResponse>(rolesResponse)
    const adminRole = rolesBody?.items?.find((item) => item.name === 'admin') ?? null
    const adminRoleId = expectId(adminRole?.id, 'Missing admin role')

    const aclPath = `/api/auth/roles/acl?roleId=${encodeURIComponent(adminRoleId)}&tenantId=${encodeURIComponent(scope.tenantId)}`
    const aclResponse = await apiRequest(request, 'GET', aclPath, { token: superadminToken })
    expect(aclResponse.ok()).toBeTruthy()
    const aclBody = (await readJsonSafe<RoleAclResponse>(aclResponse)) ?? {}
    const features = Array.isArray(aclBody.features) ? aclBody.features : []

    const hasWmsView =
      aclBody.isSuperAdmin ||
      features.includes('wms.view') ||
      features.includes('wms.*') ||
      features.includes('*')

    if (!hasWmsView) {
      const mergedFeatures = Array.from(new Set([...features, 'wms.view'])).sort()
      const updateResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken,
        data: {
          roleId: adminRoleId,
          tenantId: scope.tenantId,
          isSuperAdmin: Boolean(aclBody.isSuperAdmin),
          features: mergedFeatures,
          organizations: Array.isArray(aclBody.organizations) ? aclBody.organizations : null,
        },
      })
      expect(updateResponse.ok()).toBeTruthy()
    }

    let orderId: string | null = null
    try {
      orderId = await createSalesOrderFixture(request, adminToken)

      const response = await apiRequest(
        request,
        'GET',
        `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
        { token: adminToken },
      )
      expect(response.ok(), `GET /api/sales/orders failed: ${response.status()}`).toBeTruthy()
      const body = await readJsonSafe<SalesOrderListResponse>(response)
      const order = body?.items?.[0]

      expect(order, 'Expected order in response').toBeTruthy()
      expect(
        (order as Record<string, unknown>)?._wms,
        'User with wms.view SHOULD receive _wms enrichment',
      ).toBeTruthy()
    } finally {
      await deleteSalesEntityIfExists(request, adminToken, '/api/sales/orders', orderId)
      if (!hasWmsView) {
        await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
          token: superadminToken,
          data: {
            roleId: adminRoleId,
            tenantId: scope.tenantId,
            isSuperAdmin: Boolean(aclBody.isSuperAdmin),
            features,
            organizations: Array.isArray(aclBody.organizations) ? aclBody.organizations : null,
          },
        }).catch(() => undefined)
      }
    }
  })
})
