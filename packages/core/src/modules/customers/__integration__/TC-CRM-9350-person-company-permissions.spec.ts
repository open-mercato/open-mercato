import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('person detail and linked companies respect company and deal view access', async ({ request, page }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenScope(adminToken)
  const marker = randomUUID()
  const email = `crm-reader-${marker}@example.test`
  const password = `Test1!-${randomUUID()}`
  const personName = `Person ${marker}`
  const companyName = `Company ${marker}`
  const dealTitle = `Deal ${marker}`
  const peopleOnly = ['customers.people.view', 'dashboards.view']
  const withCompanies = [...peopleOnly, 'customers.companies.view']
  let roleId: string | null = null
  let userId: string | null = null
  let companyId: string | null = null
  let personId: string | null = null
  let dealId: string | null = null

  try {
    roleId = await createRoleFixture(request, adminToken, { name: `CRM reader ${marker}`, tenantId })
    await setRoleAclFeatures(request, adminToken, { roleId, features: [...withCompanies, 'customers.deals.view'] })
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [roleId] })
    companyId = await createCompanyFixture(request, adminToken, companyName)
    personId = await createPersonFixture(request, adminToken, {
      firstName: 'CRM', lastName: 'Reader', displayName: personName, companyEntityId: companyId,
    })
    dealId = await createDealFixture(request, adminToken, {
      title: dealTitle, companyIds: [companyId], status: 'open', valueAmount: 1250, valueCurrency: 'USD',
    })

    const token = await getAuthToken(request, email, password)
    const detailPath = `/api/customers/people/${personId}`
    const companiesPath = `${detailPath}/companies`
    const enrichedPath = `${companiesPath}/enriched`
    const pagePath = `/backend/customers/people-v2/${personId}?tab=companies`
    const get = (path: string) => apiRequest(request, 'GET', path, { token })

    const allowedDetail = await get(detailPath)
    expect(allowedDetail.status()).toBe(200)
    expect(await readJsonSafe(allowedDetail)).toMatchObject({
      canViewCompanies: true,
      company: { id: companyId, displayName: companyName },
      companies: [{ id: companyId }],
      counts: { companies: 1 },
    })
    const allowedCompanies = await get(companiesPath)
    expect(allowedCompanies.status()).toBe(200)
    expect(await readJsonSafe(allowedCompanies)).toMatchObject({ items: [{ companyId }] })
    const allowedEnriched = await get(enrichedPath)
    expect(allowedEnriched.status()).toBe(200)
    expect(await readJsonSafe(allowedEnriched)).toMatchObject({
      items: [{ companyId, activeDeal: { title: dealTitle, valueCurrency: 'USD' } }],
    })

    await acknowledgeGlobalNotices(page)
    const login = await postForm(page.request, '/api/auth/login', { email, password })
    expect(login.ok()).toBe(true)
    await page.goto(pagePath)
    await expect(page.getByRole('tab', { name: /^Companies/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('link', { name: companyName, exact: true }).first()).toBeVisible()

    await setRoleAclFeatures(request, adminToken, { roleId, features: withCompanies })
    const companiesWithoutDeals = await get(enrichedPath)
    expect(companiesWithoutDeals.status()).toBe(200)
    expect(await readJsonSafe(companiesWithoutDeals)).toMatchObject({
      items: [{ companyId, activeDeal: null, clv: null }],
    })

    await setRoleAclFeatures(request, adminToken, { roleId, features: peopleOnly })
    const restrictedDetail = await get(detailPath)
    expect(restrictedDetail.status()).toBe(200)
    expect(await readJsonSafe(restrictedDetail)).toMatchObject({
      person: { id: personId },
      canViewCompanies: false,
      company: null,
      companies: [],
      profile: { companyEntityId: null },
      counts: { companies: 0 },
      isPrimary: false,
    })
    expect((await get(companiesPath)).status()).toBe(403)
    expect((await get(enrichedPath)).status()).toBe(403)

    await page.goto(pagePath)
    await expect(page.getByRole('tab', { name: /^Activities/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: /^Companies/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: companyName, exact: true })).toHaveCount(0)
    const moreTabs = page.getByRole('button', { name: 'More', exact: true })
    if (await moreTabs.isVisible()) {
      await moreTabs.click()
      const overflow = page.getByRole('menu', { name: 'More', exact: true })
      await expect(overflow).toBeVisible()
      await expect(overflow.getByRole('menuitem', { name: /^Companies/ })).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
  } finally {
    await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/people', personId)
    await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId)
    await deleteUserIfExists(request, adminToken, userId)
    await deleteRoleIfExists(request, adminToken, roleId)
  }
})
