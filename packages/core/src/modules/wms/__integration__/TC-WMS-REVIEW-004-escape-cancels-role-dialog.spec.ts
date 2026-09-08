import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { createSite, createWarehouse, deactivateResource, deleteResource, listRoles, ROLES_PATH, WAREHOUSES_PATH } from './helpers/wmsReviewFixtures'

export const integrationMeta = { dependsOnModules: ['wms'] }

test('TC-WMS-REVIEW-004: Escape cancels a warehouse-role dialog exactly like Cancel', async ({ page, request }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites', 'wms.manage_warehouses'])
  const suffix = randomUUID().slice(0, 8)
  const warehouseName = `Escape warehouse ${suffix}`
  let siteId: string | null = null
  let warehouseId: string | null = null
  try {
    warehouseId = await createWarehouse(request, adminToken, scope, warehouseName, `ESC${suffix}`)
    siteId = await createSite(request, adminToken, scope, `Escape site ${suffix}`, `ESC${suffix}`)

    await login(page, 'admin')
    await page.goto(`/backend/wms/sites/${siteId}`)
    await page.getByRole('button', { name: /Add warehouse role/i }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: /Add warehouse role/i })
    const warehouseInput = dialog.locator('[data-crud-field-id="warehouseId"] input').first()
    await warehouseInput.fill(warehouseName)
    await warehouseInput.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(warehouseName, { exact: true })).toHaveCount(0)
    expect(await listRoles(request, adminToken, siteId, scope.organizationId)).toHaveLength(0)
  } finally {
    await deleteResource(request, adminToken, ROLES_PATH, null, scope.organizationId)
    await deactivateResource(request, adminToken, '/api/wms/sites', siteId, scope.organizationId)
    await deleteResource(request, adminToken, WAREHOUSES_PATH, warehouseId, scope.organizationId)
    await restoreAcl()
  }
})
