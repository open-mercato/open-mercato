import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { createRole, createSite, createWarehouse, deactivateResource, deleteResource, ROLES_PATH, WAREHOUSES_PATH } from './helpers/wmsReviewFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

test('TC-WMS-REVIEW-005: inactive warehouse name and status label fit in the Site warehouse column', async ({ page, request }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites', 'wms.manage_warehouses'])
  const suffix = randomUUID().slice(0, 8)
  const warehouseName = `Inactive assigned warehouse ${suffix}`
  let siteId: string | null = null
  let warehouseId: string | null = null
  let roleId: string | null = null
  try {
    warehouseId = await createWarehouse(request, adminToken, scope, warehouseName, `IAW${suffix}`)
    siteId = await createSite(request, adminToken, scope, `Inactive warehouse site ${suffix}`, `IWS${suffix}`)
    roleId = await createRole(request, adminToken, siteId, warehouseId, scope.organizationId)
    const deactivate = await apiRequest(request, 'PUT', WAREHOUSES_PATH, {
      token: adminToken,
      data: { id: warehouseId, isActive: false },
    })
    expect(deactivate.status()).toBe(200)

    await login(page, 'admin')
    await page.goto(`/backend/wms/sites/${siteId}`)
    const roleRow = page.getByRole('row').filter({ hasText: warehouseName }).first()
    await expect(roleRow).toBeVisible()
    const warehouseLabel = roleRow.getByText(warehouseName, { exact: true })
    const inactiveLabel = roleRow.getByText(/Warehouse inactive/i)
    await expect(warehouseLabel).toBeVisible()
    await expect(inactiveLabel).toBeVisible()
    await expect(warehouseLabel).toHaveCSS('display', 'block')
    const labelBox = await warehouseLabel.boundingBox()
    const inactiveBox = await inactiveLabel.boundingBox()
    expect(labelBox).not.toBeNull()
    expect(inactiveBox).not.toBeNull()
    expect(inactiveBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height - 1)
    const warehouseCell = roleRow.getByRole('cell').filter({ hasText: warehouseName }).first()
    await expect(warehouseCell).toBeVisible()
    const layout = await warehouseCell.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: element.textContent ?? '',
    }))
    expect(layout.scrollWidth, `Warehouse cell overflows: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.clientWidth)
  } finally {
    await deleteResource(request, adminToken, ROLES_PATH, roleId, scope.organizationId)
    await deactivateResource(request, adminToken, '/api/wms/sites', siteId, scope.organizationId)
    await deleteResource(request, adminToken, WAREHOUSES_PATH, warehouseId, scope.organizationId)
    await restoreAcl()
  }
})
