import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { createRole, createSite, createWarehouse, deactivateResource, deleteResource, ROLES_PATH, WAREHOUSES_PATH } from './helpers/wmsReviewFixtures'
import { fillCombobox } from './helpers/wmsUi'

export const integrationMeta = { dependsOnModules: ['wms'] }

test('TC-WMS-REVIEW-003: assigning a warehouse already used by another active Site is rejected with a readable error', async ({ page, request }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', ['wms.view', 'wms.manage_sites', 'wms.manage_warehouses'])
  const suffix = randomUUID().slice(0, 8)
  const warehouseName = `Cross-site assignment ${suffix}`
  let firstSiteId: string | null = null
  let secondSiteId: string | null = null
  let warehouseId: string | null = null
  let roleId: string | null = null
  try {
    warehouseId = await createWarehouse(request, adminToken, scope, warehouseName, `CSW${suffix}`)
    firstSiteId = await createSite(request, adminToken, scope, `Warehouse owner ${suffix}`, `CS1${suffix}`)
    secondSiteId = await createSite(request, adminToken, scope, `Warehouse claimant ${suffix}`, `CS2${suffix}`)
    roleId = await createRole(request, adminToken, firstSiteId, warehouseId, scope.organizationId)

    await login(page, 'admin')
    await page.goto(`/backend/wms/sites/${secondSiteId}`)
    await page.getByRole('button', { name: /Add warehouse role/i }).first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: /Add warehouse role/i })
    await fillCombobox(page, 'Select warehouse', warehouseName, { scope: dialog, suggestionsApiPath: '/api/wms/warehouses' })
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/wms/site-warehouse-roles'))
    await dialog.getByRole('button', { name: /^Save$/i }).click()
    expect((await responsePromise).status()).toBe(409)
    await expect(dialog).toContainText(/another active site/i)
    await expect(dialog).not.toContainText(warehouseId)
  } finally {
    await deleteResource(request, adminToken, ROLES_PATH, roleId, scope.organizationId)
    await deactivateResource(request, adminToken, '/api/wms/sites', firstSiteId, scope.organizationId)
    await deactivateResource(request, adminToken, '/api/wms/sites', secondSiteId, scope.organizationId)
    await deleteResource(request, adminToken, WAREHOUSES_PATH, warehouseId, scope.organizationId)
    await restoreAcl()
  }
})
