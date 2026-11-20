import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import english from '../i18n/en.json' with { type: 'json' }
import polish from '../i18n/pl.json' with { type: 'json' }

const collection = '/api/sales/tax-rates'
const messages = { en: english, pl: polish }

for (const locale of ['en', 'pl'] as const) {
  test(`TC-SALES-8560: ${locale} number survives create, reload and unchanged keyboard resubmission`, async ({ page, request, baseURL }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID()
    const name = `Locale roundtrip ${stamp}`
    const code = `locale-${stamp}`
    const localized = locale === 'pl' ? '7,5' : '7.5'
    const translations = messages[locale]
    let id: string | null = null

    try {
      await login(page, 'admin')
      expect(baseURL).toBeTruthy()
      await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL! }])
      await page.goto('/backend/config/sales')
      await page.getByRole('button', { name: translations['sales.config.taxRates.actions.add'], exact: true }).click()
      let dialog = page.getByRole('dialog', { name: translations['sales.config.taxRates.form.createTitle'], exact: true })
      await dialog.getByRole('textbox', { name: `${translations['sales.config.taxRates.form.name']} *`, exact: true }).fill(name)
      await dialog.getByRole('textbox', { name: `${translations['sales.config.taxRates.form.code']} *`, exact: true }).fill(code)
      const inputName = `${translations['sales.config.taxRates.form.rate']} *`
      await dialog.getByRole('textbox', { name: inputName, exact: true }).fill(localized)
      const created = page.waitForResponse((response) => new URL(response.url()).pathname === collection && response.request().method() === 'POST')
      await dialog.getByRole('textbox', { name: inputName, exact: true }).press('Control+Enter')
      const createResponse = await created
      const createBody = await readJsonSafe<{ id?: string }>(await createResponse.text())
      id = createBody?.id ?? null
      expect(createResponse.status()).toBe(201)
      expect(createResponse.request().postDataJSON()).toMatchObject({ name, code, rate: 7.5 })
      expect(id).toBeTruthy()
      await expect(dialog).toHaveCount(0)

      const assertPersisted = async () => {
        const response = await apiRequest(request, 'GET', `${collection}?id=${id}`, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ items?: Array<{ id: string; rate: number | string; code: string }> }>(await response.text())
        expect(body?.items).toEqual([expect.objectContaining({ id, code })])
        expect(Number(body?.items?.[0]?.rate)).toBe(7.5)
      }
      await assertPersisted()
      await page.reload()
      const row = page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
      await row.getByRole('button').click()
      await page.getByRole('menuitem', { name: translations['sales.config.taxRates.actions.edit'], exact: true }).click()
      dialog = page.getByRole('dialog', { name: translations['sales.config.taxRates.form.editTitle'], exact: true })
      const rateInput = dialog.getByRole('textbox', { name: inputName, exact: true })
      await expect(rateInput).toHaveValue(localized)
      const updated = page.waitForResponse((response) => new URL(response.url()).pathname === collection && response.request().method() === 'PUT')
      await rateInput.press('Control+Enter')
      const updateResponse = await updated
      expect(updateResponse.status()).toBe(200)
      expect(updateResponse.request().postDataJSON()).toMatchObject({ id, rate: 7.5 })
      await expect(dialog).toHaveCount(0)
      await page.reload()
      await assertPersisted()
      await testInfo.attach('locale-number-roundtrip', { body: await page.screenshot(), contentType: 'image/png' })
    } finally {
      if (id) {
        const removed = await apiRequest(request, 'DELETE', `${collection}?id=${id}`, { token })
        expect(removed.status(), 'owned tax rate cleanup').toBe(200)
      }
    }
  })
}
