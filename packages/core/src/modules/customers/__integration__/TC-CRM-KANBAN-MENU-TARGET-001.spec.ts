import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

test('deal menu retains a 32px target, its icon size and keyboard dismissal', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const name = `QA menu target ${Date.now()}`
  let companyId: string | null = null
  let pipelineId: string | null = null
  let stageId: string | null = null
  let dealId: string | null = null
  try {
    companyId = await createCompanyFixture(request, token, name)
    pipelineId = await createPipelineFixture(request, token, { name, isDefault: false })
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'QA stage' })
    dealId = await createDealFixture(request, token, { title: name, companyIds: [companyId], pipelineId, pipelineStageId: stageId })
    await login(page, 'admin')
    await page.goto('/backend/customers/deals/pipeline')
    await expect(page.getByRole('button', { name: 'New stage', exact: true }).first()).toBeEnabled()
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name, exact: true }).press('Enter')
    const card = page.getByLabel(`Deal: ${name}`, { exact: true })
    const trigger = card.getByRole('button', { name: 'Deal actions', exact: true })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(trigger).toBeVisible()
      const bounds = await trigger.boundingBox()
      expect(bounds?.width).toBe(32)
      expect(bounds?.height).toBe(32)
      const iconBounds = await trigger.locator('svg').boundingBox()
      expect(iconBounds?.width).toBe(14)
      await trigger.click()
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press('Enter')
      await expect(page.getByRole('menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await testInfo.attach(`deal-menu-target-${width}`, { body: await card.screenshot(), contentType: 'image/png' })
    }
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
    await deleteEntityIfExists(request, token, '/api/customers/pipeline-stages', stageId)
    await deleteEntityIfExists(request, token, '/api/customers/pipelines', pipelineId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
