import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  deleteGeneralEntityIfExists,
  getTokenScope,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCrudFixture, ensureRoleFeatures } from './helpers/wmsFixtures'
import { ensureEnglishLocale } from './helpers/wmsUi'

export const integrationMeta = {
  dependsOnModules: ['wms'],
}

test('TC-WMS-10467: ASN status and receiving queue filters preserve search', async ({ page, request }) => {
  test.slow()
  const adminToken = await getAuthToken(request, 'admin')
  const superadminToken = await getAuthToken(request, 'superadmin')
  const scope = getTokenScope(adminToken)
  const restoreAdminAcl = await ensureRoleFeatures(request, superadminToken, scope.tenantId, 'admin', [
    'wms.view',
    'wms.manage_warehouses',
    'wms.manage_asn',
  ])
  const suffix = randomUUID().slice(0, 8)
  const searchTerm = `TC10467-${suffix}`
  const transitReference = `${searchTerm}-transit`
  const draftReference = `${searchTerm}-draft`
  const decoyReference = `unrelated-${suffix}`
  const asnPath = '/api/wms/asns'
  const asnIds: string[] = []
  let warehouseId: string | null = null

  try {
    warehouseId = await createCrudFixture(request, adminToken, '/api/wms/warehouses', {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: `Test warehouse ${suffix}`,
      code: `TC10467${suffix}`,
      timezone: 'Europe/Warsaw',
    })
    for (const [referenceNumber, status] of [
      [transitReference, 'in_transit'],
      [draftReference, 'draft'],
      [decoyReference, 'draft'],
    ]) {
      asnIds.push(await createCrudFixture(request, adminToken, asnPath, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        warehouseId,
        status,
        referenceNumber,
        expectedAt: new Date().toISOString(),
      }))
    }

    await login(page, 'admin')
    await ensureEnglishLocale(page)
    await page.goto('/backend/wms/asns')

    const searchBox = page.getByPlaceholder('Search ASNs', { exact: true })
    const statusFilter = page.getByTestId('asn-status-filter')
    const transitRow = page.getByRole('link', { name: transitReference, exact: true })
    const draftRow = page.getByRole('link', { name: draftReference, exact: true })
    const decoyRow = page.getByRole('link', { name: decoyReference, exact: true })
    const urlParam = (key: string) => new URL(page.url()).searchParams.get(key)

    await searchBox.fill(searchTerm)
    await expect.poll(() => urlParam('search')).toBe(searchTerm)
    await expect(transitRow).toBeVisible()
    await expect(draftRow).toBeVisible()

    await statusFilter.click()
    await page.getByRole('option', { name: 'Draft', exact: true }).click()
    await expect.poll(() => urlParam('status')).toBe('draft')
    expect(urlParam('search')).toBe(searchTerm)
    await expect(searchBox).toHaveValue(searchTerm)
    await expect(draftRow).toBeVisible()
    await expect(transitRow).toHaveCount(0)
    await expect(decoyRow).toHaveCount(0)

    await page.reload()
    await expect(searchBox).toHaveValue(searchTerm)
    await expect(draftRow).toBeVisible()
    await expect(decoyRow).toHaveCount(0)

    await statusFilter.click()
    await page.getByRole('option', { name: 'Open receiving', exact: true }).click()
    await expect.poll(() => urlParam('queue')).toBe('open')
    expect(urlParam('status')).toBeNull()
    expect(urlParam('search')).toBe(searchTerm)
    await expect(transitRow).toBeVisible()
    await expect(decoyRow).toHaveCount(0)

    await statusFilter.click()
    await page.getByRole('option', { name: 'All statuses', exact: true }).click()
    await expect.poll(() => urlParam('queue')).toBeNull()
    expect(urlParam('search')).toBe(searchTerm)
    await expect(searchBox).toHaveValue(searchTerm)
    await expect(decoyRow).toHaveCount(0)
  } finally {
    for (const id of asnIds) {
      await deleteGeneralEntityIfExists(request, adminToken, asnPath, id)
    }
    await deleteGeneralEntityIfExists(request, adminToken, '/api/wms/warehouses', warehouseId)
    await restoreAdminAcl()
  }
})
