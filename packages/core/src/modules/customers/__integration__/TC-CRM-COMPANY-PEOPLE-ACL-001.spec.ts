import { expect, test, type Browser, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const USER_PASSWORD = 'Valid1!Pass'

async function openCompanyDetail(
  browser: Browser,
  credentials: { email: string; password: string },
  companyId: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await context.addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ])
  await page.goto('/login')
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 })
  await page.getByLabel('Email').fill(credentials.email)
  const password = page.getByLabel('Password', { exact: true })
  await password.fill(credentials.password)
  await password.press('Enter')
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/)
  await page.goto(`/backend/customers/companies/${companyId}`)
  await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 })
  return { page, close: () => context.close() }
}

/**
 * TC-CRM-COMPANY-PEOPLE-ACL-001: the company detail People tab only renders
 * linked people for callers holding `customers.people.view`. A role with
 * `customers.companies.view` alone does not see the People tab, is refused by
 * `GET /api/customers/companies/:id/people`, and never sees the linked
 * person's name; a permitted reader still opens the tab and sees it.
 */
test.describe('TC-CRM-COMPANY-PEOPLE-ACL-001: company People tab requires customers.people.view', () => {
  test('hides linked people from a companies-only role and shows them to a permitted reader', async ({ browser, request }) => {
    test.slow()
    const stamp = Date.now()
    let adminToken: string | null = null
    const roleIds: string[] = []
    const userIds: string[] = []
    let companyId: string | null = null
    let personId: string | null = null
    const displayName = `People Tab Acl ${stamp}`

    const createReader = async (suffix: string, features: string[]) => {
      if (!adminToken) throw new Error('[internal] admin token missing')
      const scope = getTokenScope(adminToken)
      const roleName = `qa_crm_people_tab_${suffix}_${stamp}`
      const roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
      roleIds.push(roleId)
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: adminToken,
        data: { roleId, features },
      })
      expect(aclResponse.ok(), 'PUT role ACL should succeed').toBeTruthy()
      const email = `qa-crm-people-tab-${suffix}-${stamp}@acme.com`
      userIds.push(await createUserFixture(request, adminToken, {
        email,
        password: USER_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleName],
        name: `QA people tab ${suffix}`,
      }))
      return { email, password: USER_PASSWORD }
    }

    try {
      adminToken = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, adminToken, `QA People Tab Co ${stamp}`)
      personId = await createPersonFixture(request, adminToken, {
        firstName: 'People',
        lastName: `Tab${stamp}`,
        displayName,
        companyEntityId: companyId,
      })

      const reader = await createReader('reader', ['customers.companies.view', 'customers.people.view'])
      const permitted = await openCompanyDetail(browser, reader, companyId)
      try {
        await permitted.page.getByRole('tab', { name: 'People' }).click()
        await expect(permitted.page.getByText(displayName).first()).toBeVisible({ timeout: 30_000 })
        const readerToken = await getAuthToken(request, reader.email, reader.password)
        const allowedResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/people`, { token: readerToken })
        expect(allowedResponse.status(), 'permitted reader loads company people').toBe(200)
      } finally {
        await permitted.close()
      }

      const companiesOnly = await createReader('companiesonly', ['customers.companies.view', 'customers.deals.view'])
      const denied = await openCompanyDetail(browser, companiesOnly, companyId)
      try {
        await expect(denied.page.getByRole('link', { name: 'Companies' }).first()).toBeVisible({ timeout: 30_000 })
        await expect(denied.page.getByRole('tab', { name: 'People' }), 'People tab hidden without customers.people.view').toHaveCount(0)
        await expect(denied.page.getByText(displayName)).toHaveCount(0)
        const companiesOnlyToken = await getAuthToken(request, companiesOnly.email, companiesOnly.password)
        const directResponse = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/people`, { token: companiesOnlyToken })
        expect(directResponse.status(), 'companies-only role is refused company people').toBe(403)
      } finally {
        await denied.close()
      }
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
      for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
