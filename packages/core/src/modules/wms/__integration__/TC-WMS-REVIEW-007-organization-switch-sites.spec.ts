import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ensureRoleFeatures } from './helpers/wmsFixtures'
import { createOrganization, createSite, deactivateResource, deleteResource, listRoles, SITES_PATH } from './helpers/wmsReviewFixtures'

export const integrationMeta = { dependsOnModules: ['wms', 'directory'] }

test('TC-WMS-REVIEW-007: switching organizations refreshes the Sites table', async ({ page, request }) => {
  test.slow()
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(superadminToken)
  const restoreAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'superadmin', ['wms.view', 'wms.manage_sites'])
  const suffix = randomUUID().slice(0, 8)
  const organizationAId = scope.organizationId
  const organizationAName = `Organization A site ${suffix}`
  const organizationBName = `Organization B sites ${suffix}`
  const organizationBSiteName = `Organization B site ${suffix}`
  let organizationBId: string | null = null
  let siteAId: string | null = null
  let siteBId: string | null = null
  try {
    organizationBId = await createOrganization(request, superadminToken, scope.tenantId, organizationBName)
    siteAId = await createSite(request, superadminToken, scope, organizationAName, `OSA${suffix}`, organizationAId)
    siteBId = await createSite(request, superadminToken, scope, organizationBSiteName, `OSB${suffix}`, organizationBId)
    expect((await listRoles(request, superadminToken, siteAId, organizationAId)).length).toBe(0)
    expect((await listRoles(request, superadminToken, siteBId, organizationBId)).length).toBe(0)

    await login(page, 'superadmin')
    await page.goto('/backend/wms/sites')
    await expect(page.getByText(organizationAName, { exact: true })).toBeVisible()
    const organizationButton = page.getByRole('button', { name: /Organization:/i }).first()
    await organizationButton.click()
    await page.getByRole('button', { name: organizationBName, exact: true }).click()
    await expect(page.getByText(organizationBSiteName, { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(organizationAName, { exact: true })).toHaveCount(0)
  } finally {
    await deactivateResource(request, superadminToken, SITES_PATH, siteAId, organizationAId)
    await deactivateResource(request, superadminToken, SITES_PATH, siteBId, organizationBId ?? undefined)
    await deleteResource(request, superadminToken, '/api/directory/organizations', organizationBId)
    await restoreAcl()
  }
})
