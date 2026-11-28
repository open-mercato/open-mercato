import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices, login } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'customers'] }

test('TC-CRM-9335: company-only viewers do not see deal KPI cards', async ({ baseURL, browser, page, request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { organizationId, tenantId } = getTokenScope(adminToken)
  const suffix = randomUUID()
  const email = `test-9335-${suffix}@example.com`
  const password = `Test!${randomUUID()}`
  let companyId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  const viewerPage = await browser.newPage({ baseURL })

  try {
    companyId = await createCompanyFixture(request, adminToken, `KPI permissions ${suffix}`)
    roleId = await createRoleFixture(request, adminToken, { name: `Company viewer ${suffix}`, tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId,
      features: ['customers.companies.view', 'dashboards.view'],
      organizations: [organizationId],
    })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })

    const companyUrl = `/backend/customers/companies-v2/${companyId}?tab=activity-log`
    await login(page, 'admin')
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('company-kpi-tile').getByText('ACTIVE DEALS', { exact: true })).toBeVisible()

    await acknowledgeGlobalNotices(viewerPage)
    const signedIn = await viewerPage.request.post('/api/auth/login', { form: { email, password } })
    expect(signedIn.status(), 'The company viewer should sign in').toBe(200)
    await viewerPage.goto(companyUrl, { waitUntil: 'domcontentloaded' })

    const tiles = viewerPage.getByTestId('company-kpi-tile')
    await expect(tiles.getByText('ACTIVITIES', { exact: true })).toBeVisible()
    await expect(tiles.getByText('CLIENT SINCE', { exact: true })).toBeVisible()
    await expect(tiles.getByText('ACTIVE DEALS', { exact: true })).toHaveCount(0)
    await expect(tiles.getByText('CUSTOMER VALUE (LTV)', { exact: true })).toHaveCount(0)
  } finally {
    await viewerPage.close()
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
  }
})
