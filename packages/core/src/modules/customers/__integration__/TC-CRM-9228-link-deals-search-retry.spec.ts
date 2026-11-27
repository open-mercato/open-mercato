import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

test('TC-CRM-9228: Retry stays visible after a failed deal search in the narrow dialog', async ({ page, request }) => {
  const stamp = Date.now()
  const selectedTitle = `QA 9228 Selected ${stamp}`
  const targetTitle = `QA 9228 Retry ${stamp}`
  const token = await getAuthToken(request)
  let companyId: string | null = null
  let selectedDealId: string | null = null
  let targetDealId: string | null = null

  try {
    companyId = await createCompanyFixture(request, token, `QA 9228 Company ${stamp}`)
    selectedDealId = await createDealFixture(request, token, { title: selectedTitle })
    targetDealId = await createDealFixture(request, token, { title: targetTitle })

    await page.setViewportSize({ width: 480, height: 860 })
    await login(page, 'admin')
    await page.goto(`/backend/customers/companies-v2/${companyId}?tab=deals`)
    await page.getByRole('button', { name: 'Link existing deal', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Link deals' })
    const search = dialog.getByRole('textbox', { name: /search all deals/i })
    await search.fill(selectedTitle)
    await dialog.getByRole('button', { name: new RegExp(selectedTitle) }).first().click()
    const selectedCount = dialog.getByText('1 deal selected', { exact: true })
    await expect(selectedCount).toBeVisible()

    const origin = new URL(page.url()).origin
    const isTargetSearch = (url: URL) => url.origin === origin
      && url.pathname === '/api/customers/deals'
      && url.searchParams.get('search') === targetTitle
    await page.route(isTargetSearch, (route) => route.abort('internetdisconnected'), { times: 1 })
    await search.fill(targetTitle)

    const error = dialog.getByRole('alert')
    const retry = error.getByRole('button', { name: 'Retry', exact: true })
    await expect(error).toContainText('Could not load search results.')
    await expect(retry).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByText('0 results', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('No matching deals found.', { exact: true })).toHaveCount(0)

    await page.setViewportSize({ width: 480, height: 380 })
    await retry.scrollIntoViewIfNeeded()
    await expect(retry).toBeInViewport({ ratio: 1 })

    await page.setViewportSize({ width: 480, height: 860 })
    await retry.press('Enter')
    await expect(dialog.getByRole('button', { name: new RegExp(targetTitle) })).toBeVisible()
    await expect(error).toHaveCount(0)
    await expect(search).toHaveValue(targetTitle)
    await expect(selectedCount).toBeVisible()
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/deals', targetDealId)
    await deleteEntityIfExists(request, token, '/api/customers/deals', selectedDealId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
