import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { createOrganization, createWarehouse, deleteResource, listWarehouses, WAREHOUSES_PATH } from './helpers/wmsReviewFixtures'

export const integrationMeta = { dependsOnModules: ['wms', 'directory'] }

test('TC-WMS-REVIEW-006: switching organizations refreshes the Warehouses table', async ({ page, request }) => {
  test.slow()
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(superadminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'superadmin', ['wms.view', 'wms.manage_warehouses'])
  const suffix = randomUUID().slice(0, 8)
  const organizationAId = scope.organizationId
  const organizationAName = `Organization A warehouse ${suffix}`
  const organizationBName = `Organization B ${suffix}`
  const organizationBWarehouseName = `Organization B warehouse ${suffix}`
  let organizationBId: string | null = null
  let warehouseAId: string | null = null
  let warehouseBId: string | null = null
  try {
    organizationBId = await createOrganization(request, superadminToken, scope.tenantId, organizationBName)
    warehouseAId = await createWarehouse(request, superadminToken, scope, organizationAName, `OWA${suffix}`, { organizationId: organizationAId })
    warehouseBId = await createWarehouse(request, superadminToken, scope, organizationBWarehouseName, `OWB${suffix}`, { organizationId: organizationBId })
    expect((await listWarehouses(request, superadminToken, organizationAId)).some((item) => item.id === warehouseAId)).toBe(true)
    expect((await listWarehouses(request, superadminToken, organizationBId)).some((item) => item.id === warehouseBId)).toBe(true)

    await login(page, 'superadmin')
    await page.goto('/backend/wms/warehouses')
    await expect(page.getByText(organizationAName, { exact: true })).toBeVisible()
    const organizationButton = page.getByRole('button', { name: /Organization:/i }).first()
    await organizationButton.click()
    await page.getByRole('button', { name: organizationBName, exact: true }).click()
    await expect(page.getByText(organizationBWarehouseName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(organizationAName, { exact: true })).toHaveCount(0)
  } finally {
    await deleteResource(request, superadminToken, WAREHOUSES_PATH, warehouseAId, organizationAId)
    await deleteResource(request, superadminToken, WAREHOUSES_PATH, warehouseBId, organizationBId ?? undefined)
    await deleteResource(request, superadminToken, '/api/directory/organizations', organizationBId)
    await restoreAcl()
  }
})
