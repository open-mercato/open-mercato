import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

test('the Lost confirmation explains whether a deal can be reopened', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const title = `TC-CRM-4330 ${randomUUID()}`
  const dealId = await createDealFixture(request, token, { title })

  try {
    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close deal', exact: true }).click()
    await page.getByRole('button', { name: 'Lost', exact: true }).click()

    await expect(page.getByRole('dialog').getByText(/cannot be undone without 'sales\.reopen'/)).toBeVisible()
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
  }
})
