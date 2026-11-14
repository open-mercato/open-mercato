import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const currencyLabels = [
  'EUR',
  'USD – US Dollar',
  'GBP – British Pound',
  'PLN – Polish Zloty',
  'CHF',
  'JPY – Japanese Yen',
  'KES – Kenyan Shilling',
]

test('TC-CRM-7498: both deal selectors show currency codes once and preserve saved codes', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request)
  const suffix = randomUUID()
  const companyName = `Currency regression company ${suffix}`
  const dealTitle = `Currency regression deal ${suffix}`
  const pipelineName = `Currency regression pipeline ${suffix}`
  const stageLabel = `Currency regression stage ${suffix}`
  let companyId: string | null = null
  let pipelineId: string | null = null
  let stageId: string | null = null
  let dealId: string | null = null

  const findCreatedDeal = async () => {
    const response = await apiRequest(request, 'GET', `/api/customers/deals?search=${encodeURIComponent(dealTitle)}&pageSize=10`, { token })
    expect(response.ok()).toBeTruthy()
    const payload = await readJsonSafe<{ items?: Array<{ id: string; title: string }> }>(response)
    return payload?.items?.find((item) => item.title === dealTitle)?.id ?? null
  }

  const expectSavedCurrency = async (currency: string) => {
    const response = await apiRequest(request, 'GET', `/api/customers/deals/${encodeURIComponent(dealId!)}`, { token })
    expect(response.ok()).toBeTruthy()
    const payload = await readJsonSafe<{ deal?: { valueCurrency?: string } }>(response)
    expect(payload?.deal?.valueCurrency).toBe(currency)
  }

  try {
    companyId = await createCompanyFixture(request, token, companyName)
    pipelineId = await createPipelineFixture(request, token, { name: pipelineName })
    stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageLabel, order: 0 })

    await page.route('**/api/customers/dictionaries/currency', (route) => route.fulfill({
      json: {
        id: randomUUID(),
        entries: [
          { id: randomUUID(), value: 'jpy', label: 'JPY – Japanese Yen' },
          { id: randomUUID(), value: 'USD', label: 'USD – US Dollar' },
          { id: randomUUID(), value: 'KES', label: 'Kenyan Shilling' },
          { id: randomUUID(), value: 'EUR', label: 'EUR' },
          { id: randomUUID(), value: 'GBP', label: 'GBP – British Pound' },
          { id: randomUUID(), value: 'PLN', label: 'PLN – Polish Zloty' },
          { id: randomUUID(), value: 'CHF', label: null },
        ],
      },
    }))

    await login(page, 'admin')
    await page.goto('/backend/customers/deals/create')
    const createButton = page.getByRole('button', { name: 'Create deal', exact: true }).first()
    await expect(createButton).toBeEnabled()
    await page.getByRole('textbox', { name: 'Deal title *', exact: true }).fill(dealTitle)
    await page.getByRole('textbox', { name: 'Deal value', exact: true }).fill('100')
    await page.getByRole('combobox', { name: 'Pipeline', exact: true }).click()
    await page.getByRole('option', { name: pipelineName, exact: true }).click()
    await page.getByRole('combobox', { name: 'Pipeline stage', exact: true }).click()
    await page.getByRole('option', { name: stageLabel, exact: false }).click()
    await page.getByRole('searchbox', { name: 'Companies', exact: true }).fill(companyName)
    await page.getByRole('button', { name: companyName, exact: true }).click()

    const createCurrency = page.getByRole('combobox', { name: 'Currency', exact: true })
    await expect(createCurrency).toBeEnabled()
    await createCurrency.click()
    await expect(page.getByRole('option')).toHaveText(currencyLabels)
    await page.screenshot({ path: testInfo.outputPath('currency-create-options.png'), fullPage: true })
    await page.getByRole('option', { name: 'USD – US Dollar', exact: true }).press('Enter')
    await expect(createCurrency).toHaveText('USD – US Dollar')
    await page.screenshot({ path: testInfo.outputPath('currency-create-usd.png'), fullPage: true })

    const created = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/customers/deals')
    await createButton.click()
    const createResponse = await created
    expect(createResponse.status()).toBe(201)
    expect(createResponse.request().postDataJSON()).toMatchObject({ valueCurrency: 'USD' })
    dealId = await findCreatedDeal()
    expect(dealId).toBeTruthy()
    await expectSavedCurrency('USD')

    await page.goto(`/backend/customers/deals/${encodeURIComponent(dealId!)}`)
    await page.getByRole('button', { name: 'Expand form panel', exact: true }).click()
    const editCurrency = page.locator('[data-crud-field-id="valueCurrency"]').getByRole('combobox')
    await expect(editCurrency).toHaveText('USD – US Dollar')
    await editCurrency.click()
    await expect(page.getByRole('option')).toHaveText(currencyLabels)
    await page.getByRole('option', { name: 'JPY – Japanese Yen', exact: true }).press('Enter')
    await expect(editCurrency).toHaveText('JPY – Japanese Yen')

    const updated = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/customers/deals')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const updateResponse = await updated
    expect(updateResponse.status()).toBe(200)
    expect(updateResponse.request().postDataJSON()).toMatchObject({ valueCurrency: 'JPY' })
    await expectSavedCurrency('JPY')

    await page.reload()
    await page.getByRole('button', { name: 'Expand form panel', exact: true }).click()
    await expect(editCurrency).toHaveText('JPY – Japanese Yen')
    await page.screenshot({ path: testInfo.outputPath('currency-reopened-jpy.png'), fullPage: true })
  } finally {
    try {
      dealId ??= await findCreatedDeal()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
    }
  }
})
