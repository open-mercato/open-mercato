import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const scenarios = [
  { kind: 'company', tab: 'deals', addLabel: 'Add deal', linkLabel: 'Link existing deal' },
  { kind: 'person', tab: 'deals', addLabel: 'Add deal', linkLabel: 'Link existing deal' },
  { kind: 'company', tab: 'people', addLabel: 'Add person', linkLabel: 'Link existing person' },
] as const

test.describe('TC-CRM-6859: One Add action per customer detail tab', () => {
  for (const version of ['classic', 'v2'] as const) {
    for (const scenario of scenarios) {
      test(`${version} ${scenario.kind} ${scenario.tab} keeps one working Add button`, async ({ page, request }, testInfo) => {
        let token: string | null = null
        let companyId: string | null = null
        let personId: string | null = null
        let dealId: string | null = null
        const fixtureName = `TC-CRM-6859 ${Date.now()}`

        try {
          await page.setViewportSize({ width: 1440, height: 960 })
          token = await getAuthToken(request)
          companyId = await createCompanyFixture(request, token, fixtureName)
          personId = await createPersonFixture(request, token, {
            firstName: 'Tab',
            lastName: 'Actions',
            displayName: `${fixtureName} person`,
            companyEntityId: companyId,
          })
          if (scenario.tab === 'deals') {
            dealId = await createDealFixture(request, token, {
              title: `${fixtureName} deal`,
              companyIds: [companyId],
              personIds: [personId],
            })
          }

          await login(page, 'admin')
          const collection = scenario.kind === 'company' ? 'companies' : 'people'
          const entityId = scenario.kind === 'company' ? companyId : personId
          const suffix = version === 'v2' ? '-v2' : ''
          await page.goto(`/backend/customers/${collection}${suffix}/${entityId}?tab=${scenario.tab}`)
          await expect(page.getByText(`${fixtureName} ${scenario.tab === 'deals' ? 'deal' : 'person'}`, { exact: true })).toBeVisible()

          const addButton = page.getByRole('button', { name: scenario.addLabel, exact: true })
          await expect(addButton).toHaveCount(1)
          await expect(addButton).toBeEnabled()
          await expect(page.getByRole('button', { name: scenario.linkLabel, exact: true })).toBeEnabled()
          const screenshotPath = testInfo.outputPath('tab-actions.png')
          await page.screenshot({ path: screenshotPath, fullPage: true })
          await testInfo.attach('tab-actions', { path: screenshotPath, contentType: 'image/png' })

          await addButton.click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).toHaveCount(0)
          await page.getByRole('button', { name: scenario.linkLabel, exact: true }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
        } finally {
          await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
          await deleteEntityIfExists(request, token, '/api/customers/people', personId)
          await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
        }
      })
    }
  }
})
