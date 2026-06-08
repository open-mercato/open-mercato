import { expect, test } from '@playwright/test'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-CRM-075: Customer edit forms prefill saved selects', () => {
  test('deal edit shows the saved pipeline and stage immediately on open', async ({ page, request }) => {
    test.slow()
    test.setTimeout(120_000)

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
      await page.goto(`/backend/customers/deals/${encodeURIComponent(dealId)}`, { waitUntil: 'domcontentloaded' })

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

  test('person detail company edit shows a saved company outside the first async page', async ({ page, request }) => {
    test.slow()
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const companyIds: string[] = []
    let personId: string | null = null
    let selectedCompanyId: string | null = null
    let selectedCompanyName = ''

    try {
      const batchSize = 12
      for (let index = 0; index < 105; index += batchSize) {
        const batch = Array.from({ length: Math.min(batchSize, 105 - index) }, (_, offset) => index + offset)
        companyIds.push(
          ...(await Promise.all(
            batch.map((entry) => {
              const name = `QA Select Company ${stamp} ${String(entry).padStart(3, '0')}`
              return createCompanyFixture(request, token, name)
            }),
          )),
        )
      }

      const listResponse = await apiRequest(
        request,
        'GET',
        '/api/customers/companies?page=1&pageSize=100&sortField=displayName&sortDir=asc',
        { token },
      )
      expect(listResponse.ok(), `Failed to list companies: ${listResponse.status()}`).toBeTruthy()
      const listBody = await readJsonSafe(listResponse)
      const firstPageIds = new Set(
        (Array.isArray((listBody as any).items) ? (listBody as any).items : [])
          .map((item: Record<string, unknown>) => (typeof item.id === 'string' ? item.id : null))
          .filter((id: string | null): id is string => Boolean(id)),
      )

      selectedCompanyId = companyIds.find((id) => !firstPageIds.has(id)) ?? companyIds.at(-1) ?? null
      expect(selectedCompanyId, 'Expected one created company to be outside the first company page').toBeTruthy()
      selectedCompanyName = `QA Select Company ${stamp} ${String(companyIds.indexOf(selectedCompanyId as string)).padStart(3, '0')}`

      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Select ${stamp}`,
        displayName: `QA Select Person ${stamp}`,
        companyEntityId: selectedCompanyId as string,
      })

      await login(page, 'admin')
      await page.goto(`/backend/customers/people/${encodeURIComponent(personId)}`)
      await expect(page.getByText(`QA Select Person ${stamp}`, { exact: true }).first()).toBeVisible()

      const companyPanel = page
        .getByText('Company', { exact: true })
        .locator('xpath=ancestor::div[contains(@class,"group")]')
        .first()
      await expect(companyPanel.getByText(selectedCompanyName, { exact: true })).toBeVisible()
      await companyPanel.getByRole('button', { name: 'Edit' }).click({ force: true })
      await expect(companyPanel.getByRole('combobox')).toContainText(selectedCompanyName)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      for (const companyId of companyIds.reverse()) {
        await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      }
    }
  })
})
