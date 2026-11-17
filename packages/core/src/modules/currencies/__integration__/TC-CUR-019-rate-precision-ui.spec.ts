import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ExchangeRateListResponse = {
  items?: Array<{ id: string; rate: string; source: string | null; metadata: Record<string, unknown> | null }>
}

const PRECISE_RATE = '0.000000123456789012345678901234567891'

/**
 * TC-CUR-019: the exchange-rate editor keeps every digit of a rate, shows the direction as
 * "1 FROM = rate TO" and shows provider metadata read-only, keeping it on save.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */
test.describe('TC-CUR-019: exchange-rate editor precision round trip', () => {
  test('shows every rate digit, keeps provider metadata on save and keeps the rate exact', async ({ page, request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)
    let fromId: string | null = null
    let toId: string | null = null
    let rateId: string | null = null

    try {
      const from = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-019 From' })
      fromId = from.id
      const to = await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-019 To' })
      toId = to.id
      const created = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token,
        data: {
          organizationId,
          tenantId,
          fromCurrencyCode: from.code,
          toCurrencyCode: to.code,
          rate: PRECISE_RATE,
          date: new Date().toISOString(),
          source: 'QA-Precision-UI',
          metadata: { tableNo: '001/A/NBP/2026' },
        },
      })
      expect(created.status()).toBe(201)
      rateId = (await readJsonSafe<{ id?: string }>(created))?.id ?? null
      expect(rateId).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/exchange-rates/${encodeURIComponent(rateId!)}`, { waitUntil: 'domcontentloaded' })
      const rateInput = page.getByLabel('Exchange Rate', { exact: false })
      await expect(rateInput).toHaveValue(PRECISE_RATE, { timeout: 30_000 })

      await expect(page.getByText(`1 ${from.code} =`, { exact: true })).toBeVisible()
      await expect(page.getByText(to.code, { exact: true }).first()).toBeVisible()
      await expect(page.getByPlaceholder('{ "key": "value" }')).toHaveCount(0)
      await expect(page.getByText('001/A/NBP/2026', { exact: true })).toBeVisible()

      const sourceInput = page.getByLabel('Source', { exact: false })
      await sourceInput.fill('QA-Precision-UI-Edited')
      const saved = page.waitForResponse((response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/currencies/exchange-rates',
      )
      await page.getByRole('button', { name: 'Save Changes' }).first().click()
      expect((await saved).status()).toBe(200)

      const readBack = await apiRequest(request, 'GET', `/api/currencies/exchange-rates?id=${rateId}`, { token })
      const item = (await readJsonSafe<ExchangeRateListResponse>(readBack))?.items?.[0]
      expect(item?.rate).toBe(PRECISE_RATE)
      expect(item?.source).toBe('QA-Precision-UI-Edited')
      expect(item?.metadata).toEqual({ tableNo: '001/A/NBP/2026' })

      await page.goto(`/backend/exchange-rates/${encodeURIComponent(rateId!)}`, { waitUntil: 'domcontentloaded' })
      await expect(rateInput).toHaveValue(PRECISE_RATE, { timeout: 30_000 })

      await page.setViewportSize({ width: 390, height: 844 })
      await expect(rateInput).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromId)
    }
  })
})
