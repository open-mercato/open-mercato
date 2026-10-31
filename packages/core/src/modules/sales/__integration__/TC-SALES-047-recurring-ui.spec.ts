import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'

/**
 * TC-SALES-047 — recurring billing UI (spec 2026-10-21-sales-recurring-orders, phase 1 step 4).
 *
 * The create form previews the calculated dates, the order detail page shows the schedule
 * and edits it through the recurrence dialog, and the public quote page shows the schedule.
 */

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as JsonRecord
  } catch {
    return {}
  }
}

function isoDayFromToday(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

async function createDocument(
  request: APIRequestContext,
  token: string,
  resource: 'orders' | 'quotes',
  data: JsonRecord,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `/api/sales/${resource}`, { token, data })
  expect(response.status(), `POST /api/sales/${resource}`).toBe(201)
  return (await readJson(response)).id as string
}

const line = { currencyCode: 'USD', name: 'QA TC-SALES-047 service', quantity: 1, unitPriceNet: 100, unitPriceGross: 123, taxRate: 23 }

test.describe('TC-SALES-047 recurring billing UI', () => {
  test('the create form previews the first invoice and end date of a monthly schedule', async ({ page }) => {
    test.slow()
    await login(page, 'admin')
    await page.goto('/backend/sales/documents/create?kind=order', { waitUntil: 'domcontentloaded' })
    const fields = page.getByTestId('sales-recurrence-fields')
    await expect(fields).toBeVisible({ timeout: 60_000 })

    const toggle = page.getByTestId('sales-recurrence-toggle')
    await expect(async () => {
      if ((await toggle.getAttribute('data-state')) !== 'checked') await toggle.click()
      await expect(toggle).toHaveAttribute('data-state', 'checked', { timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByTestId('sales-recurrence-period-count')).toHaveValue('12')
    const preview = page.getByTestId('sales-recurrence-preview')
    await expect(preview).toContainText('First invoice on')
    await expect(preview).toContainText('Ends on')

    await page.getByTestId('sales-recurrence-open-ended').click()
    await expect(preview).toContainText('No end date')
    await expect(page.getByTestId('sales-recurrence-period-count')).toBeDisabled()
  })

  test('the order detail page shows the schedule and saves an edited one', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let orderId: string | null = null
    try {
      orderId = await createDocument(request, token, 'orders', {
        currencyCode: 'USD',
        lines: [line],
        recurrence: { frequency: 'monthly', startsOn: isoDayFromToday(20), periodCount: 12 },
      })
      await login(page, 'admin')
      await page.goto(`/backend/sales/documents/${orderId}?kind=order`, { waitUntil: 'domcontentloaded' })
      const section = page.getByTestId('sales-recurrence-section')
      await expect(section).toBeVisible({ timeout: 60_000 })
      await expect(page.getByTestId('sales-recurrence-schedule')).toContainText('12 payments')
      await expect(section).toContainText('Scheduled')

      await page.getByTestId('sales-recurrence-edit').click()
      const dialog = page.getByRole('dialog')
      const periodCount = dialog.getByTestId('sales-recurrence-period-count')
      await periodCount.fill('6')
      await expect(dialog.getByTestId('sales-recurrence-preview')).toContainText('Ends on')
      await periodCount.press('ControlOrMeta+Enter')

      await expect(page.getByTestId('sales-recurrence-schedule')).toContainText('6 payments', { timeout: 30_000 })
      const stored = await apiRequest(request, 'GET', `/api/sales/orders?id=${orderId}`, { token })
      const item = (((await readJson(stored)).items ?? []) as JsonRecord[])[0]
      expect(item.recurrence).toMatchObject({ periodCount: 6, scheduleVersion: 2 })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('the public quote page shows the schedule', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const publicToken = randomUUID()
    let quoteId: string | null = null
    try {
      quoteId = await createDocument(request, token, 'quotes', {
        currencyCode: 'USD',
        recurrence: { frequency: 'quarterly', startsOn: isoDayFromToday(15), periodCount: 8 },
      })
      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', { token, data: { quoteId, ...line } })
      expect(lineResponse.status()).toBe(201)
      await withClient(async (client) => {
        const result = await client.query(
          `update sales_quotes set acceptance_token = $2, status = 'sent', updated_at = now() where id = $1`,
          [quoteId, hashAuthToken(publicToken)],
        )
        expect(result.rowCount).toBe(1)
      })

      await page.goto(`/quote/${publicToken}`, { waitUntil: 'domcontentloaded' })
      const schedule = page.getByTestId('public-quote-recurrence')
      await expect(schedule).toBeVisible({ timeout: 60_000 })
      await expect(schedule).toContainText('Quarterly from')
      await expect(schedule).toContainText('8 payments')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
})
