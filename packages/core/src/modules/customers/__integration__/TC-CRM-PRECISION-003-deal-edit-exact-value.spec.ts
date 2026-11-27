import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { deleteEntityByBody, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-CRM-PRECISION-003: a deal value stored through the API with more digits than a float
 * holds survives a detail-editor save that only changes the title.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const DEALS_API_BASE = '/api/customers/deals'
const EXACT_VALUE = '25.123456789012345678'

async function readDealValue(request: APIRequestContext, token: string, dealId: string) {
  const response = await apiRequest(request, 'GET', `${DEALS_API_BASE}/${encodeURIComponent(dealId)}`, { token })
  expect(response.status(), 'GET deal should return 200').toBe(200)
  const body = (await readJsonSafe(response)) as { deal?: { title?: string; valueAmount?: string | null } }
  return body.deal ?? null
}

async function openDealFormTitleInput(page: Page) {
  const titleInput = page.locator('[data-crud-field-id="title"] input:visible').first()
  if (!(await titleInput.isVisible().catch(() => false))) {
    const expandPanel = page.getByRole('button', { name: /expand form panel/i })
    await expect(expandPanel).toBeVisible({ timeout: 15_000 })
    await expandPanel.click()
  }
  await expect(titleInput).toBeVisible({ timeout: 15_000 })
  await expect(titleInput).not.toHaveValue('', { timeout: 15_000 })
  return titleInput
}

test('TC-CRM-PRECISION-003: a title-only deal edit keeps the exact value', async ({ page }) => {
  test.slow()
  const token = await getAuthToken(page.request, 'admin')
  const stamp = Date.now()
  const newTitle = `QA Precision 003 renamed ${stamp}`
  let dealId: string | null = null

  try {
    const createResponse = await apiRequest(page.request, 'POST', DEALS_API_BASE, {
      token,
      data: { title: `QA Precision 003 ${stamp}`, valueAmount: EXACT_VALUE, valueCurrency: 'USD' },
    })
    expect(createResponse.status(), 'deal should be created').toBe(201)
    const created = (await readJsonSafe(createResponse)) as { id?: string; entityId?: string }
    dealId = created.id ?? created.entityId ?? null
    expect(typeof dealId, 'create response should expose the deal id').toBe('string')
    expect((await readDealValue(page.request, token, dealId as string))?.valueAmount).toBe(EXACT_VALUE)

    await login(page, 'admin')
    await page.goto(`/backend/customers/deals/${dealId}`)
    const titleInput = await openDealFormTitleInput(page)
    await fillControlledInput(titleInput, newTitle)

    const saveButton = page.getByRole('button', { name: /^save$/i }).first()
    await expect(saveButton).toBeEnabled({ timeout: 10_000 })
    const settled = await waitForApiMutation(page, DEALS_API_BASE, () => saveButton.click(), 'PUT', 15_000)
    expect(settled.status(), 'the title-only save should succeed').toBeLessThan(400)

    const after = await readDealValue(page.request, token, dealId as string)
    expect(after?.title).toBe(newTitle)
    expect(after?.valueAmount).toBe(EXACT_VALUE)
  } finally {
    await deleteEntityByBody(page.request, token, DEALS_API_BASE, dealId)
  }
})
