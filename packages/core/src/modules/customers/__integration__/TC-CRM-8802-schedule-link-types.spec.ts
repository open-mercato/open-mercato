import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { hasAllFeatures } from '@open-mercato/shared/security/features'

export const integrationMeta = { dependsOnModules: ['customers'] }

test('TC-CRM-8802: schedule link types follow enabled modules and built-in types remain searchable', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const stamp = Date.now()
  const companyName = `QA schedule link company ${stamp}`
  const dealTitle = `QA schedule link deal ${stamp}`
  let companyId: string | null = null
  let dealId: string | null = null

  try {
    const navResponse = await apiRequest(request, 'GET', '/api/auth/admin/nav', { token })
    expect(navResponse.status()).toBe(200)
    const nav = await readJsonSafe<{ grantedFeatures?: string[] }>(navResponse)
    expect(Array.isArray(nav?.grantedFeatures)).toBe(true)
    const canViewOffers = hasAllFeatures(nav?.grantedFeatures, ['sales.quotes.view'])
    const expectedTypes = ['company', 'deal', ...(canViewOffers ? ['offer'] : [])]

    companyId = await createCompanyFixture(request, token, companyName)
    dealId = await createDealFixture(request, token, { title: dealTitle, companyIds: [companyId] })

    await login(page, 'admin')
    await page.goto(`/backend/customers/companies-v2/${companyId}`)
    await page.getByRole('tab', { name: 'Activity log', exact: true }).click()
    await page.getByRole('button', { name: 'Add new', exact: true }).click()
    await page.getByRole('button', { name: 'New task', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New task', exact: true })
    await expect(dialog.locator('[data-schedule-link-types-loading]')).toHaveAttribute('data-schedule-link-types-loading', 'false')
    await dialog.getByRole('button', { name: '+ Add link', exact: true }).click()
    const picker = page.getByRole('dialog').filter({ has: page.locator('[data-schedule-link-type="company"]') })
    const typeButtons = picker.locator('[data-schedule-link-type]')
    await expect(typeButtons).toHaveCount(expectedTypes.length)
    expect(await typeButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-schedule-link-type')))).toEqual(expectedTypes)
    await expect(picker.getByRole('button', { name: 'Offer', exact: true })).toHaveCount(canViewOffers ? 1 : 0)

    const search = picker.getByPlaceholder('Search...', { exact: true })
    for (const link of [
      { type: 'Company', path: '/api/customers/companies', label: companyName },
      { type: 'Deal', path: '/api/customers/deals', label: dealTitle },
    ]) {
      await picker.getByRole('button', { name: link.type, exact: true }).click()
      const response = page.waitForResponse((candidate) => {
        const url = new URL(candidate.url())
        return url.pathname === link.path && url.searchParams.get('search') === link.label && candidate.request().method() === 'GET'
      })
      await search.fill(link.label)
      expect((await response).status()).toBe(200)
      await expect(picker.getByRole('button', { name: link.label, exact: true })).toBeVisible()
    }
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
