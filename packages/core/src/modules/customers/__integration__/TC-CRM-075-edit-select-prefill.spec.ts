import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-CRM-075: Customer edit forms prefill saved selects', () => {
  test('deal edit shows the saved pipeline and stage immediately on open', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let companyId: string | null = null
    let pipelineId: string | null = null
    let stageId: string | null = null
    let dealId: string | null = null
    const companyName = `QA Prefill Customer Co ${stamp}`
    const pipelineName = `QA Prefill Pipeline ${stamp}`
    const stageName = `QA Prefill Stage ${stamp}`
    const dealTitle = `QA Prefill Deal ${stamp}`

    try {
      companyId = await createCompanyFixture(request, token, companyName)
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName })
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageName, order: 0 })
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
      })

      await login(page, 'admin')
      await page.goto(`/backend/customers/deals/${encodeURIComponent(dealId)}`)

      await expect(page.getByText(dealTitle, { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Expand form panel' }).click()
      const pipelineField = page.locator('[data-crud-field-id="pipelineId"]').first()
      const stageField = page.locator('[data-crud-field-id="pipelineStageId"]').first()
      await expect(pipelineField.getByRole('combobox').first()).toContainText(pipelineName)
      await expect(stageField.getByRole('combobox').first()).toContainText(stageName)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
    }
  })
})
